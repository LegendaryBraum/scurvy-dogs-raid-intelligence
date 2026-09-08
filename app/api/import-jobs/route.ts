import { ensureSchema, getRuntimeEnv, makeId } from "../../../db/runtime";
import {
  fetchFightContextEvents,
  fetchReportOverview,
  fetchRuleEvents,
  getWarcraftLogsAccessToken,
  groupRuleEventsByAbility,
  parseRankingRows,
  parseReportUrls,
  type WarcraftLogsCredentials,
  type WclRankingRow,
  type WclReportOverview,
  WarcraftLogsRateLimitError,
} from "../../../lib/warcraft-logs";
import { analyzeFightRules, type StoredRule } from "../../../lib/rule-analysis";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type JobStatus = "queued" | "processing" | "paused" | "failed" | "completed";
type ImportJobRow = {
  id: string;
  report_code: string;
  report_url: string;
  season_id: string;
  raid_night_id: string;
  replace_existing: number;
  selected_fight_ids_json: string;
  completed_fight_ids_json: string;
  snapshot_json: string | null;
  staging_report_id: string | null;
  status: JobStatus;
  total_pulls: number;
  completed_pulls: number;
  current_label: string | null;
  player_rows: number;
  event_rows: number;
  error_message: string | null;
  retry_after_seconds: number | null;
  resume_after: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ImportSelection = { code: string; fightIds: number[]; startedAt?: number };
type StartPayload = {
  action: "start";
  urls?: string[] | string;
  season?: string;
  raidNight?: string;
  raidNightId?: string;
  selections?: ImportSelection[];
  replaceReportCodes?: string[];
};
type ProcessPayload = { action: "process"; jobId?: string };
type JobSnapshot = {
  report: { title: string; startTime: number; endTime: number; zoneName: string };
  fights: WclReportOverview["fights"];
  actors: NonNullable<NonNullable<WclReportOverview["masterData"]>["actors"]>;
  abilities: NonNullable<NonNullable<WclReportOverview["masterData"]>["abilities"]>;
  rankings: WclRankingRow[];
  pullNumbers: Record<string, number>;
};

function parseJson<T>(value: string | null, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function record(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function roleFromSpec(spec: string) {
  if (["Restoration", "Holy", "Discipline", "Mistweaver", "Preservation"].includes(spec)) return "Healer";
  if (["Protection", "Blood", "Brewmaster", "Guardian", "Vengeance"].includes(spec)) return "Tank";
  return "DPS";
}
function eventSpellId(value: unknown) { const event = record(value); return number(event.abilityGameID ?? event.abilityID ?? record(event.ability).gameID ?? record(event.ability).id); }
function eventActorId(value: unknown, preferSource = false) { const event = record(value); return number(preferSource ? (event.sourceID ?? event.targetID) : (event.targetID ?? event.sourceID)); }
function eventTimestamp(value: unknown, fallback: number) { return number(record(value).timestamp) || fallback; }

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return `${prefix}_${Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function publicJob(job: ImportJobRow) {
  return {
    id: job.id,
    raidNightId: job.raid_night_id,
    reportCode: job.report_code,
    reportUrl: job.report_url,
    status: job.status,
    totalPulls: Number(job.total_pulls),
    completedPulls: Number(job.completed_pulls),
    currentLabel: job.current_label,
    error: job.error_message,
    retryAfterSeconds: job.retry_after_seconds === null ? undefined : Number(job.retry_after_seconds),
    resumeAfter: job.resume_after,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  };
}

async function readJob(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM import_jobs WHERE id = ?").bind(id).first<ImportJobRow>();
}

async function removeReport(db: D1Database, reportId: string) {
  await db.batch([
    db.prepare("DELETE FROM officer_notes WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM rule_analysis_state WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM events WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pull_players WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pulls WHERE report_id = ?").bind(reportId),
    db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId),
  ]);
}

async function removeStagedPull(db: D1Database, pullId: string) {
  await db.batch([
    db.prepare("DELETE FROM shares WHERE pull_id = ?").bind(pullId),
    db.prepare("DELETE FROM rule_analysis_state WHERE pull_id = ?").bind(pullId),
    db.prepare("DELETE FROM events WHERE pull_id = ?").bind(pullId),
    db.prepare("DELETE FROM pull_players WHERE pull_id = ?").bind(pullId),
    db.prepare("DELETE FROM pulls WHERE id = ?").bind(pullId),
  ]);
}

function credentials(): WarcraftLogsCredentials {
  const runtimeEnv = getRuntimeEnv();
  if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) throw new Error("The one-time Warcraft Logs connection has not been completed yet.");
  return { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };
}

async function prepareJob(db: D1Database, job: ImportJobRow) {
  const { report: overview } = await fetchReportOverview(job.report_code, credentials());
  const selected = new Set(parseJson<number[]>(job.selected_fight_ids_json, []));
  const originalPullNumbers: Record<string, number> = {};
  const pullCounters = new Map<string, number>();
  for (const fight of overview.fights.filter((candidate) => candidate.encounterID > 0)) {
    const key = `${fight.encounterID}:${fight.difficulty ?? 0}`;
    const pullNumber = (pullCounters.get(key) ?? 0) + 1;
    pullCounters.set(key, pullNumber);
    originalPullNumbers[String(fight.id)] = pullNumber;
  }
  const fights = overview.fights.filter((fight) => fight.encounterID > 0 && selected.has(fight.id));
  if (!fights.length) throw new Error("None of the selected pulls are raid encounters in this report.");
  const zones = [...new Set(fights.map((fight) => fight.gameZone?.name).filter((name): name is string => Boolean(name)))];
  const zoneName = zones.length === 1 ? zones[0] : zones.length > 1 ? `${zones.length} selected zones` : overview.zone?.name ?? "Unknown raid";
  const snapshot: JobSnapshot = {
    report: { title: overview.title, startTime: overview.startTime, endTime: overview.endTime, zoneName },
    fights,
    actors: overview.masterData?.actors ?? [],
    abilities: overview.masterData?.abilities ?? [],
    rankings: parseRankingRows(overview.rankings),
    pullNumbers: originalPullNumbers,
  };
  const stagingReportId = job.staging_report_id ?? makeId("report");
  const pendingCode = `pending:${job.id}`;
  const nextFight = fights[0];
  await db.batch([
    db.prepare("INSERT INTO reports (id, raid_night_id, code, url, title, zone_name, start_time, end_time, source_mode, included) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'importing', 0) ON CONFLICT(id) DO UPDATE SET title = excluded.title, zone_name = excluded.zone_name, start_time = excluded.start_time, end_time = excluded.end_time")
      .bind(stagingReportId, job.raid_night_id, pendingCode, job.report_url, overview.title, zoneName, overview.startTime, overview.endTime),
    db.prepare("UPDATE import_jobs SET snapshot_json = ?, staging_report_id = ?, status = 'queued', total_pulls = ?, current_label = ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(snapshot), stagingReportId, fights.length, nextFight ? `Ready for ${nextFight.name} · Pull ${originalPullNumbers[String(nextFight.id)] ?? 1}` : "Ready to finish", job.id),
  ]);
  const storedSpellIds = await db.prepare("SELECT DISTINCT spell_id FROM mechanic_rules").all<{ spell_id: number }>();
  const wantedIcons = new Set(storedSpellIds.results.map((row) => Number(row.spell_id)));
  const iconUpdates = snapshot.abilities.filter((ability) => ability.icon && wantedIcons.has(ability.gameID)).map((ability) => db.prepare("UPDATE mechanic_rules SET icon = ? WHERE spell_id = ?").bind(ability.icon, ability.gameID));
  if (iconUpdates.length) await db.batch(iconUpdates);
}

async function finalizeJob(db: D1Database, job: ImportJobRow) {
  if (!job.staging_report_id) throw new Error("The staged report is missing.");
  const existing = await db.prepare("SELECT id FROM reports WHERE code = ? AND source_mode = 'live'").bind(job.report_code).first<{ id: string }>();
  if (existing && !job.replace_existing) throw new Error("This report was imported by another job before this one completed.");
  const statements: D1PreparedStatement[] = [];
  if (existing && existing.id !== job.staging_report_id) {
    statements.push(
      db.prepare(`UPDATE officer_notes SET pull_id = (
        SELECT replacement.id
        FROM pulls original
        JOIN pulls replacement ON replacement.report_id = ? AND replacement.fight_id = original.fight_id
        WHERE original.id = officer_notes.pull_id AND original.report_id = ?
        LIMIT 1
      ) WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?) AND EXISTS (
        SELECT 1
        FROM pulls original
        JOIN pulls replacement ON replacement.report_id = ? AND replacement.fight_id = original.fight_id
        WHERE original.id = officer_notes.pull_id AND original.report_id = ?
      )`).bind(job.staging_report_id, existing.id, existing.id, job.staging_report_id, existing.id),
      db.prepare("UPDATE officer_notes SET pull_id = NULL WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(existing.id),
      db.prepare("DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(existing.id),
      db.prepare("DELETE FROM rule_analysis_state WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(existing.id),
      db.prepare("DELETE FROM events WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(existing.id),
      db.prepare("DELETE FROM pull_players WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(existing.id),
      db.prepare("DELETE FROM pulls WHERE report_id = ?").bind(existing.id),
      db.prepare("DELETE FROM reports WHERE id = ?").bind(existing.id),
    );
  }
  statements.push(
    db.prepare("UPDATE reports SET code = ?, source_mode = 'live', included = 1, imported_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.report_code, job.staging_report_id),
    db.prepare("UPDATE import_jobs SET status = 'completed', completed_pulls = total_pulls, current_label = 'Import complete', error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id),
  );
  await db.batch(statements);
}

async function processFight(db: D1Database, job: ImportJobRow, snapshot: JobSnapshot) {
  if (!job.staging_report_id) throw new Error("The staged report has not been prepared.");
  const completed = new Set(parseJson<number[]>(job.completed_fight_ids_json, []));
  const fight = snapshot.fights.find((candidate) => !completed.has(candidate.id));
  if (!fight) { await finalizeJob(db, job); return; }

  const pullId = `${job.staging_report_id}_fight_${fight.id}`;
  await removeStagedPull(db, pullId);
  const bossId = `${job.season_id}_encounter_${fight.encounterID}`;
  const configured = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(bossId).all<StoredRule>();
  const scoredRules = configured.results.filter((rule) => parseJson<{ scoringMode?: string }>(rule.condition_json, {}).scoringMode !== "context");
  const token = await getWarcraftLogsAccessToken(credentials());
  const [ruleEvents, contextEvents] = await Promise.all([
    fetchRuleEvents(job.report_code, [fight.id], scoredRules.map((rule) => ({ spellId: rule.spell_id, eventType: rule.event_type })), token),
    fetchFightContextEvents(job.report_code, fight.id, token),
  ]);

  const abilities = new Map(snapshot.abilities.map((ability) => [ability.gameID, { name: ability.name, icon: ability.icon }]));
  const participantIds = new Map<number, string>();
  const participantRoles = new Map<string, string>();
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO bosses (id, season_id, encounter_id, raid_name, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season_id, encounter_id) DO UPDATE SET raid_name = excluded.raid_name, name = excluded.name")
      .bind(bossId, job.season_id, fight.encounterID, fight.gameZone?.name ?? snapshot.report.zoneName, fight.name),
    db.prepare("INSERT INTO pulls (id, report_id, boss_id, fight_id, pull_number, difficulty, killed, start_time, end_time, boss_percentage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pullId, job.staging_report_id, bossId, fight.id, snapshot.pullNumbers[String(fight.id)] ?? 1, fight.difficulty ?? null, fight.kill ? 1 : 0, fight.startTime, fight.endTime, fight.bossPercentage ?? null),
  ];
  let playerRows = 0;
  for (const [participantIndex, actorId] of (fight.friendlyPlayers ?? []).entries()) {
    const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
    if (!actor) continue;
    const realm = actor.server ?? "";
    const playerId = await stableId("player", `${actor.name}|${realm}`);
    const ranking = snapshot.rankings.find((row) => row.fightId === fight.id && row.name.toLowerCase() === actor.name.toLowerCase());
    const spec = ranking?.spec ?? fight.friendlySpecs?.[participantIndex] ?? "Unknown";
    const role = ranking?.role && ["Tank", "Healer", "DPS"].includes(ranking.role) ? ranking.role : roleFromSpec(spec);
    const parse = ranking?.parse ?? 0;
    const ilvlParse = ranking?.ilvlParse ?? 0;
    const performanceScore = parse > 0 ? clampScore(parse * .65 + (ilvlParse > 0 ? ilvlParse : parse) * .35) : 0;
    const amount = ranking?.amount ?? 0;
    statements.push(
      db.prepare("INSERT INTO players (id, name, realm, class_name, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, realm) DO UPDATE SET class_name = excluded.class_name, role = excluded.role").bind(playerId, actor.name, realm, actor.subType, role),
      db.prepare("INSERT INTO player_identities (player_id, identity_id) VALUES (?, ?) ON CONFLICT(player_id) DO NOTHING").bind(playerId, playerId),
      db.prepare("INSERT INTO pull_players (id, pull_id, player_id, spec, dps, hps, parse, ilvl_parse, mechanics_score, performance_score, attendance_score, preparation_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 100, 0)")
        .bind(`${pullId}_${playerId}`, pullId, playerId, spec, role === "Healer" ? 0 : amount, role === "Healer" ? amount : 0, parse, ilvlParse, performanceScore),
    );
    participantIds.set(actorId, playerId);
    participantRoles.set(playerId, role);
    playerRows += 1;
  }
  await db.batch(statements);

  let eventRows = 0;
  const contextStatements: D1PreparedStatement[] = [];
  for (const [kind, values] of [["death", contextEvents.deaths], ["interrupt", contextEvents.interrupts], ["dispel", contextEvents.dispels]] as const) {
    for (const raw of values) {
      const preferSource = kind === "interrupt" || kind === "dispel";
      const playerId = participantIds.get(eventActorId(raw, preferSource));
      if (!playerId) continue;
      const event = record(raw);
      const spellId = eventSpellId(raw);
      const stoppedId = number(event.extraAbilityGameID ?? event.extraAbilityID);
      const abilityMetadata = abilities.get(spellId);
      const ability = abilityMetadata?.name ?? (kind === "death" ? "Death" : kind === "interrupt" ? "Interrupt" : "Dispel");
      const stopped = stoppedId ? abilities.get(stoppedId)?.name : null;
      const detail = kind === "death" ? "Death recorded by Warcraft Logs" : stopped ? `${kind === "interrupt" ? "Interrupted" : "Removed"} ${stopped}` : `${kind === "interrupt" ? "Interrupt" : "Dispel"} recorded by Warcraft Logs`;
      contextStatements.push(db.prepare("INSERT INTO events (id, pull_id, player_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(makeId("event"), pullId, playerId, spellId, kind, eventTimestamp(raw, fight.startTime), number(event.amount) || null, kind === "death" ? "death" : "utility", JSON.stringify({ ability, icon: abilityMetadata?.icon ?? undefined, detail, source: "Warcraft Logs" })));
      eventRows += 1;
    }
  }
  if (contextStatements.length) await db.batch(contextStatements);
  const analyzed = await analyzeFightRules({
    db, bossId, reportCode: job.report_code, fight, pullId, token, rules: configured.results, participantIds, participantRoles, abilities, contextEvents,
    eventPages: groupRuleEventsByAbility(ruleEvents, scoredRules.map((rule) => rule.spell_id)),
  });
  eventRows += analyzed.eventRows;
  completed.add(fight.id);
  const nextFight = snapshot.fights.find((candidate) => !completed.has(candidate.id));
  await db.prepare("UPDATE import_jobs SET completed_fight_ids_json = ?, completed_pulls = ?, player_rows = player_rows + ?, event_rows = event_rows + ?, status = 'queued', current_label = ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(JSON.stringify([...completed]), completed.size, playerRows, eventRows, nextFight ? `Ready for ${nextFight.name} · Pull ${snapshot.pullNumbers[String(nextFight.id)] ?? 1}` : "Finishing report", job.id).run();
  if (!nextFight) {
    const refreshed = await readJob(db, job.id);
    if (refreshed) await finalizeJob(db, refreshed);
  }
}

async function processJob(db: D1Database, jobId: string) {
  let job = await readJob(db, jobId);
  if (!job) return { missing: true as const };
  if (job.status === "completed") return { job: publicJob(job) };
  if (job.status === "paused" && job.resume_after && Date.parse(job.resume_after) > Date.now()) return { job: publicJob(job), rateLimited: true };
  const claim = await db.prepare("UPDATE import_jobs SET status = 'processing', current_label = COALESCE(current_label, 'Preparing report'), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (status IN ('queued', 'paused', 'failed') OR (status = 'processing' AND updated_at < datetime('now', '-2 minutes')))")
    .bind(jobId).run();
  if (!claim.meta.changes) return { job: publicJob(job), busy: true };
  job = await readJob(db, jobId);
  if (!job) return { missing: true as const };
  try {
    if (!job.snapshot_json) await prepareJob(db, job);
    else await processFight(db, job, parseJson<JobSnapshot>(job.snapshot_json, {} as JobSnapshot));
  } catch (error) {
    if (error instanceof WarcraftLogsRateLimitError) {
      const retry = Math.max(1, error.retryAfterSeconds ?? 300);
      const resumeAfter = new Date(Date.now() + retry * 1000).toISOString();
      await db.prepare("UPDATE import_jobs SET status = 'paused', current_label = 'Paused safely', error_message = ?, retry_after_seconds = ?, resume_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(error.message, retry, resumeAfter, job.id).run();
    } else {
      await db.prepare("UPDATE import_jobs SET status = 'failed', current_label = 'Needs attention', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(error instanceof Error ? error.message : "The import step failed.", job.id).run();
    }
  }
  const refreshed = await readJob(db, jobId);
  return refreshed ? { job: publicJob(refreshed), rateLimited: refreshed.status === "paused" } : { missing: true as const };
}

async function startJobs(db: D1Database, payload: StartPayload) {
  const parsed = parseReportUrls(payload.urls ?? []);
  if (!parsed.reports.length) return { error: "Add at least one valid Warcraft Logs report URL.", status: 400 };
  const selections = (payload.selections ?? []).filter((selection) => selection.fightIds.some(Number.isInteger));
  if (!selections.length) return { error: "Review the report and select at least one pull before importing.", status: 400 };
  credentials();
  const seasonName = payload.season?.trim() || "Current season";
  const seasonId = await stableId("season", seasonName);
  await db.prepare("INSERT INTO seasons (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1").bind(seasonId, seasonName).run();
  const replaceCodes = new Set(payload.replaceReportCodes ?? []);
  const requestedByCode = new Map(parsed.reports.map((report) => [report.code, report]));
  const candidates: Array<{ selection: ImportSelection; url: string; replace: boolean }> = [];
  const skipped: Array<{ code: string; reason: string }> = [];
  let raidNightId = payload.raidNightId?.trim() || null;

  if (raidNightId) {
    const night = await db.prepare("SELECT id FROM raid_nights WHERE id = ? AND season_id = ?").bind(raidNightId, seasonId).first<{ id: string }>();
    if (!night) return { error: "That raid night is no longer available for another report.", status: 404 };
  }
  for (const selection of selections) {
    const requested = requestedByCode.get(selection.code);
    if (!requested) continue;
    const active = await db.prepare("SELECT * FROM import_jobs WHERE report_code = ? AND status != 'completed' ORDER BY created_at DESC LIMIT 1").bind(selection.code).first<ImportJobRow>();
    if (active) { skipped.push({ code: selection.code, reason: "already_queued" }); continue; }
    const existing = await db.prepare("SELECT id, raid_night_id FROM reports WHERE code = ? AND source_mode = 'live'").bind(selection.code).first<{ id: string; raid_night_id: string }>();
    const replace = replaceCodes.has(selection.code);
    if (existing && !replace) { skipped.push({ code: selection.code, reason: "already_imported" }); continue; }
    if (!raidNightId && existing && replace) raidNightId = existing.raid_night_id;
    candidates.push({ selection: { ...selection, fightIds: [...new Set(selection.fightIds.filter(Number.isInteger))] }, url: requested.url, replace });
  }
  if (!candidates.length) {
    const existingJobs = await db.prepare("SELECT * FROM import_jobs WHERE status != 'completed' ORDER BY created_at").all<ImportJobRow>();
    return { jobs: existingJobs.results.map(publicJob), skipped };
  }
  if (!raidNightId) {
    raidNightId = makeId("night");
    const happenedAt = new Date(Math.min(...candidates.map((candidate) => candidate.selection.startedAt || Date.now()))).toISOString();
    const defaultNight = new Date(happenedAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    await db.prepare("INSERT INTO raid_nights (id, season_id, name, happened_at) VALUES (?, ?, ?, ?)")
      .bind(raidNightId, seasonId, payload.raidNight?.trim() || defaultNight, happenedAt).run();
  }
  const jobs: ImportJobRow[] = [];
  for (const candidate of candidates) {
    const id = makeId("import");
    await db.prepare("INSERT INTO import_jobs (id, report_code, report_url, season_id, raid_night_id, replace_existing, selected_fight_ids_json, total_pulls, current_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Waiting to read report')")
      .bind(id, candidate.selection.code, candidate.url, seasonId, raidNightId, candidate.replace ? 1 : 0, JSON.stringify(candidate.selection.fightIds), candidate.selection.fightIds.length).run();
    const job = await readJob(db, id);
    if (job) jobs.push(job);
  }
  const activeJobs = await db.prepare("SELECT * FROM import_jobs WHERE status != 'completed' ORDER BY created_at").all<ImportJobRow>();
  return { jobs: activeJobs.results.map(publicJob), skipped };
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    const jobs = await db.prepare("SELECT * FROM import_jobs WHERE status != 'completed' ORDER BY created_at").all<ImportJobRow>();
    return Response.json({ jobs: jobs.results.map(publicJob) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Import jobs could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as StartPayload | ProcessPayload;
    const db = await ensureSchema();
    if (payload.action === "start") {
      const result = await startJobs(db, payload);
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }
    if (payload.action === "process" && payload.jobId) {
      const result = await processJob(db, payload.jobId);
      if ("missing" in result) return Response.json({ error: "That import job no longer exists." }, { status: 404 });
      return Response.json(result);
    }
    return Response.json({ error: "Choose an import job action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The import job could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { jobId?: string };
    if (!payload.jobId) return Response.json({ error: "Choose an unfinished import to remove." }, { status: 400 });
    const db = await ensureSchema();
    const job = await readJob(db, payload.jobId);
    if (!job) return Response.json({ deleted: true });
    if (job.status === "completed") return Response.json({ error: "Completed reports are managed from Raid Data." }, { status: 409 });
    const stillRunning = await db.prepare("SELECT id FROM import_jobs WHERE id = ? AND status = 'processing' AND updated_at >= datetime('now', '-2 minutes')").bind(job.id).first<{ id: string }>();
    if (stillRunning) return Response.json({ error: "That pull is still finishing. Wait a moment, then remove the import from its saved checkpoint." }, { status: 409 });
    if (job.staging_report_id) await removeReport(db, job.staging_report_id);
    await db.prepare("DELETE FROM import_jobs WHERE id = ?").bind(job.id).run();
    const remaining = await db.prepare("SELECT COUNT(*) AS count FROM reports WHERE raid_night_id = ?").bind(job.raid_night_id).first<{ count: number }>();
    const otherJobs = await db.prepare("SELECT COUNT(*) AS count FROM import_jobs WHERE raid_night_id = ?").bind(job.raid_night_id).first<{ count: number }>();
    if (!Number(remaining?.count) && !Number(otherJobs?.count)) await db.prepare("DELETE FROM raid_nights WHERE id = ?").bind(job.raid_night_id).run();
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The unfinished import could not be removed." }, { status: 500 });
  }
}
