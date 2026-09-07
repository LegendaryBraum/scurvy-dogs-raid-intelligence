import { ensureSchema, getRuntimeEnv, makeId } from "../../../db/runtime";
import {
  analyzeFightRules,
  clearPullRuleEvents,
  markPullRuleAnalysis,
  recomputePullMechanicsScores,
  type StoredRule,
} from "../../../lib/rule-analysis";
import {
  fetchReportOverview,
  fetchRuleEvents,
  getWarcraftLogsAccessToken,
  groupRuleEventsByAbility,
  type WarcraftLogsCredentials,
  type WclReportOverview,
  WarcraftLogsRateLimitError,
} from "../../../lib/warcraft-logs";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type JobStatus = "queued" | "processing" | "paused" | "failed" | "stopped" | "completed";
type JobMode = "changed" | "full";
type ReanalysisJobRow = {
  id: string;
  boss_id: string;
  boss_name: string;
  difficulty: number;
  pull_ids_json: string;
  completed_pull_ids_json: string;
  status: JobStatus;
  total_pulls: number;
  completed_pulls: number;
  current_label: string | null;
  event_rows: number;
  players_penalized: number;
  rules_count: number;
  error_message: string | null;
  retry_after_seconds: number | null;
  resume_after: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  mode: JobMode;
  rule_ids_json: string;
  cancel_requested: number;
};

type PullRow = {
  id: string;
  report_id: string;
  fight_id: number;
  pull_number: number;
  difficulty: number;
  start_time: number;
  end_time: number;
  imported_at: string;
  code: string;
  boss_name: string;
};

type PullPlayerRow = { player_id: string; name: string; realm: string; role: string };
type RuleStateRow = { pull_id: string; rule_id: string; rule_updated_at: string };
type ImportSnapshot = {
  report?: { title?: string; startTime?: number; endTime?: number; zoneName?: string };
  fights?: WclReportOverview["fights"];
  actors?: NonNullable<NonNullable<WclReportOverview["masterData"]>["actors"]>;
  abilities?: NonNullable<NonNullable<WclReportOverview["masterData"]>["abilities"]>;
};
type ReanalysisPlan = {
  bossId: string;
  bossName: string;
  difficulty: string;
  pullCount: number;
  ruleCount: number;
  fullPullCount: number;
  activeRuleCount: number;
  current: boolean;
  pullIds: string[];
  ruleIds: string[];
};

const difficultyIds: Record<string, number> = { Normal: 3, Heroic: 4, Mythic: 5 };
const difficultyNames: Record<number, string> = { 3: "Normal", 4: "Heroic", 5: "Mythic" };
const visibleStatuses = "'queued', 'processing', 'paused', 'failed', 'stopped'";

function parseJson<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function credentials(): WarcraftLogsCredentials {
  const runtimeEnv = getRuntimeEnv();
  if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) throw new Error("The Warcraft Logs connection is not available.");
  return { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };
}

function ruleApplies(rule: StoredRule, difficulty: string) {
  const difficulties = parseJson<string[]>(rule.difficulties_json, []);
  return difficulties.length === 0 || difficulties.includes(difficulty);
}

function scoringMode(rule: StoredRule) {
  return parseJson<{ scoringMode?: string }>(rule.condition_json, {}).scoringMode ??
    (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
}

function publicJob(job: ReanalysisJobRow) {
  return {
    id: job.id,
    bossId: job.boss_id,
    bossName: job.boss_name,
    difficulty: difficultyNames[job.difficulty] ?? "Unknown",
    status: job.status,
    mode: job.mode ?? "full",
    cancelRequested: Boolean(job.cancel_requested),
    totalPulls: Number(job.total_pulls),
    completedPulls: Number(job.completed_pulls),
    currentLabel: job.current_label,
    events: Number(job.event_rows),
    playerScoreUpdates: Number(job.players_penalized),
    rules: Number(job.rules_count),
    error: job.error_message,
    retryAfterSeconds: job.retry_after_seconds === null ? undefined : Number(job.retry_after_seconds),
    resumeAfter: job.resume_after,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  };
}

async function readJob(db: D1Database, id: string) {
  return db.prepare("SELECT rj.*, b.name AS boss_name FROM reanalysis_jobs rj JOIN bosses b ON b.id = rj.boss_id WHERE rj.id = ?")
    .bind(id).first<ReanalysisJobRow>();
}

async function activeJobs(db: D1Database) {
  const jobs = await db.prepare(`SELECT rj.*, b.name AS boss_name FROM reanalysis_jobs rj JOIN bosses b ON b.id = rj.boss_id WHERE rj.status IN (${visibleStatuses}) ORDER BY rj.updated_at DESC`)
    .all<ReanalysisJobRow>();
  return jobs.results.map(publicJob);
}

async function pullRows(db: D1Database, bossId: string, difficultyId: number) {
  const result = await db.prepare("SELECT p.id, p.report_id, p.fight_id, p.pull_number, p.difficulty, p.start_time, p.end_time, r.imported_at, r.code, b.name AS boss_name FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id JOIN bosses b ON b.id = p.boss_id WHERE p.boss_id = ? AND p.difficulty = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live' ORDER BY r.start_time, p.fight_id")
    .bind(bossId, difficultyId).all<PullRow>();
  return result.results;
}

async function stateRows(db: D1Database, bossId: string, difficultyId: number) {
  const result = await db.prepare("SELECT ras.pull_id, ras.rule_id, ras.rule_updated_at FROM rule_analysis_state ras JOIN pulls p ON p.id = ras.pull_id JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id WHERE p.boss_id = ? AND p.difficulty = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live'")
    .bind(bossId, difficultyId).all<RuleStateRow>();
  return result.results;
}

async function pullStateRows(db: D1Database, pullId: string) {
  const result = await db.prepare("SELECT pull_id, rule_id, rule_updated_at FROM rule_analysis_state WHERE pull_id = ?")
    .bind(pullId).all<RuleStateRow>();
  return result.results;
}

async function fullBaselines(db: D1Database, bossId: string, difficultyId: number) {
  const rows = await db.prepare("SELECT pull_ids_json, completed_at FROM reanalysis_jobs WHERE boss_id = ? AND difficulty = ? AND mode = 'full' AND status = 'completed' AND completed_at IS NOT NULL ORDER BY completed_at DESC")
    .bind(bossId, difficultyId).all<{ pull_ids_json: string; completed_at: string }>();
  const baselines = new Map<string, number>();
  for (const row of rows.results) {
    const completedAt = timestamp(row.completed_at);
    for (const pullId of parseJson<string[]>(row.pull_ids_json, [])) {
      if (completedAt > (baselines.get(pullId) ?? 0)) baselines.set(pullId, completedAt);
    }
  }
  return baselines;
}

function staleRulesForPull(
  pull: PullRow,
  rules: StoredRule[],
  state: Map<string, RuleStateRow>,
  difficulty: string,
  fullBaseline: number,
  allowedRuleIds?: Set<string>,
) {
  return rules.filter((rule) => {
    if (allowedRuleIds && !allowedRuleIds.has(rule.id)) return false;
    const existing = state.get(`${pull.id}:${rule.id}`);
    if (!ruleApplies(rule, difficulty) && !existing) return false;
    if (existing && timestamp(existing.rule_updated_at) >= timestamp(rule.updated_at)) return false;
    if (timestamp(pull.imported_at) >= timestamp(rule.updated_at)) return false;
    if (fullBaseline >= timestamp(rule.updated_at)) return false;
    return true;
  });
}

async function buildPlan(db: D1Database, bossId: string, difficulty: string): Promise<ReanalysisPlan | null> {
  const difficultyId = difficultyIds[difficulty];
  if (!difficultyId) return null;
  const boss = await db.prepare("SELECT name FROM bosses WHERE id = ?").bind(bossId).first<{ name: string }>();
  if (!boss) return null;
  const [pulls, ruleResult, states, baselines] = await Promise.all([
    pullRows(db, bossId, difficultyId),
    db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? ORDER BY updated_at").bind(bossId).all<StoredRule>(),
    stateRows(db, bossId, difficultyId),
    fullBaselines(db, bossId, difficultyId),
  ]);
  const state = new Map(states.map((row) => [`${row.pull_id}:${row.rule_id}`, row]));
  const affectedPullIds = new Set<string>();
  const affectedRuleIds = new Set<string>();
  for (const pull of pulls) {
    for (const rule of staleRulesForPull(pull, ruleResult.results, state, difficulty, baselines.get(pull.id) ?? 0)) {
      affectedPullIds.add(pull.id);
      affectedRuleIds.add(rule.id);
    }
  }
  const applicableRules = ruleResult.results.filter((rule) => ruleApplies(rule, difficulty));
  return {
    bossId,
    bossName: boss.name,
    difficulty,
    pullCount: affectedPullIds.size,
    ruleCount: affectedRuleIds.size,
    fullPullCount: pulls.length,
    activeRuleCount: applicableRules.filter((rule) => Boolean(rule.enabled)).length,
    current: affectedPullIds.size === 0,
    pullIds: [...affectedPullIds],
    ruleIds: [...affectedRuleIds],
  };
}

async function startJob(db: D1Database, bossId: string, difficulty: string, mode: JobMode) {
  const difficultyId = difficultyIds[difficulty];
  if (!difficultyId) return { error: "Choose Normal, Heroic, or Mythic.", status: 400 } as const;
  credentials();
  const currentPlan = await buildPlan(db, bossId, difficulty);
  if (!currentPlan) return { error: "That boss is no longer available.", status: 404 } as const;
  if (!currentPlan.activeRuleCount) return { error: `Add at least one active ${difficulty} rule before recalculating.`, status: 409 } as const;
  const pullIds = mode === "full"
    ? (await pullRows(db, bossId, difficultyId)).map((pull) => pull.id)
    : currentPlan.pullIds;
  const ruleResult = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? ORDER BY updated_at").bind(bossId).all<StoredRule>();
  const ruleIds = mode === "full"
    ? ruleResult.results.filter((rule) => ruleApplies(rule, difficulty)).map((rule) => rule.id)
    : currentPlan.ruleIds;
  if (!pullIds.length) {
    return { error: mode === "full" ? `No saved ${difficulty} pulls were found for ${currentPlan.bossName}.` : `${currentPlan.bossName} ${difficulty} is already current.`, status: mode === "full" ? 404 : 409 } as const;
  }

  const existing = await db.prepare(`SELECT rj.*, b.name AS boss_name FROM reanalysis_jobs rj JOIN bosses b ON b.id = rj.boss_id WHERE rj.boss_id = ? AND rj.difficulty = ? AND rj.mode = ? AND rj.status IN (${visibleStatuses}) ORDER BY rj.updated_at DESC LIMIT 1`)
    .bind(bossId, difficultyId, mode).first<ReanalysisJobRow>();
  if (existing) {
    const running = existing.status === "processing" && timestamp(existing.updated_at) > Date.now() - 120_000;
    return { job: publicJob(existing), busy: running, stopped: existing.status === "stopped" } as const;
  }

  const id = makeId("reanalysis");
  const currentLabel = `${currentPlan.bossName} · ${difficulty} pull 1 of ${pullIds.length}`;
  await db.prepare("INSERT INTO reanalysis_jobs (id, boss_id, difficulty, pull_ids_json, total_pulls, current_label, rules_count, mode, rule_ids_json, cancel_requested) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
    .bind(id, bossId, difficultyId, JSON.stringify(pullIds), pullIds.length, currentLabel, ruleIds.length, mode, JSON.stringify(ruleIds)).run();
  const job = await readJob(db, id);
  if (!job) return { error: "The recalculation could not be prepared.", status: 500 } as const;
  return { job: publicJob(job) } as const;
}

async function recordCompletedPull(db: D1Database, job: ReanalysisJobRow, pullId: string, events: number, playerScoreUpdates: number) {
  const completed = new Set(parseJson<string[]>(job.completed_pull_ids_json, []));
  completed.add(pullId);
  const pullIds = parseJson<string[]>(job.pull_ids_json, []);
  const remaining = pullIds.filter((id) => !completed.has(id));
  const control = await db.prepare("SELECT cancel_requested FROM reanalysis_jobs WHERE id = ?").bind(job.id).first<{ cancel_requested: number }>();
  const finished = remaining.length === 0;
  const stopped = !finished && Boolean(control?.cancel_requested);
  const status: JobStatus = finished ? "completed" : stopped ? "stopped" : "queued";
  const label = finished
    ? "Dashboards updated"
    : stopped
      ? `Stopped safely after ${completed.size} of ${pullIds.length} pulls`
      : `${job.boss_name} · ${difficultyNames[job.difficulty] ?? "Unknown"} pull ${completed.size + 1} of ${pullIds.length}`;
  await db.prepare("UPDATE reanalysis_jobs SET completed_pull_ids_json = ?, completed_pulls = ?, status = ?, current_label = ?, event_rows = event_rows + ?, players_penalized = players_penalized + ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(JSON.stringify([...completed]), completed.size, status, label, events, playerScoreUpdates, finished ? new Date().toISOString() : null, job.id).run();
}

async function reportFromSnapshot(db: D1Database, pull: PullRow) {
  const row = await db.prepare("SELECT snapshot_json FROM import_jobs WHERE report_code = ? AND status = 'completed' AND snapshot_json IS NOT NULL ORDER BY completed_at DESC LIMIT 1")
    .bind(pull.code).first<{ snapshot_json: string | null }>();
  const snapshot = parseJson<ImportSnapshot>(row?.snapshot_json ?? null, {});
  if (snapshot.fights?.length && snapshot.actors && snapshot.abilities) {
    return {
      code: pull.code,
      title: snapshot.report?.title ?? pull.code,
      startTime: snapshot.report?.startTime ?? 0,
      endTime: snapshot.report?.endTime ?? 0,
      visibility: "unknown",
      zone: snapshot.report?.zoneName ? { name: snapshot.report.zoneName } : null,
      fights: snapshot.fights,
      masterData: { actors: snapshot.actors, abilities: snapshot.abilities },
    } satisfies WclReportOverview;
  }
  return (await fetchReportOverview(pull.code, credentials())).report;
}

async function processPull(db: D1Database, job: ReanalysisJobRow) {
  const pullIds = parseJson<string[]>(job.pull_ids_json, []);
  const completed = new Set(parseJson<string[]>(job.completed_pull_ids_json, []));
  const pullId = pullIds.find((id) => !completed.has(id));
  if (!pullId) {
    await db.prepare("UPDATE reanalysis_jobs SET status = 'completed', completed_pulls = total_pulls, current_label = 'Dashboards updated', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id).run();
    return;
  }
  const pull = await db.prepare("SELECT p.id, p.report_id, p.fight_id, p.pull_number, p.difficulty, p.start_time, p.end_time, r.imported_at, r.code, b.name AS boss_name FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id JOIN bosses b ON b.id = p.boss_id WHERE p.id = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live'")
    .bind(pullId).first<PullRow>();
  if (!pull) { await recordCompletedPull(db, job, pullId, 0, 0); return; }

  const difficulty = difficultyNames[job.difficulty] ?? "Unknown";
  const [ruleResult, states, baselines] = await Promise.all([
    db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? ORDER BY updated_at").bind(job.boss_id).all<StoredRule>(),
    pullStateRows(db, pull.id),
    fullBaselines(db, job.boss_id, job.difficulty),
  ]);
  const state = new Map(states.map((row) => [`${row.pull_id}:${row.rule_id}`, row]));
  const configuredRuleIds = new Set(parseJson<string[]>(job.rule_ids_json, []));
  const targetRules = job.mode === "full"
    ? ruleResult.results.filter((rule) => ruleApplies(rule, difficulty))
    : staleRulesForPull(pull, ruleResult.results, state, difficulty, baselines.get(pull.id) ?? 0, configuredRuleIds);
  if (job.mode === "changed" && !targetRules.length) {
    await recordCompletedPull(db, job, pullId, 0, 0);
    return;
  }
  const analysisRules = targetRules.filter((rule) => Boolean(rule.enabled) && ruleApplies(rule, difficulty));
  const scoredRules = analysisRules.filter((rule) => scoringMode(rule) !== "context");

  if (!scoredRules.length) {
    if (job.mode === "full") await db.prepare("DELETE FROM events WHERE pull_id = ? AND rule_id IS NOT NULL").bind(pull.id).run();
    else await clearPullRuleEvents(db, pull.id, targetRules.map((rule) => rule.id));
    const scoreResult = await recomputePullMechanicsScores(db, pull.id, job.boss_id, difficulty);
    await markPullRuleAnalysis(db, pull.id, targetRules);
    await recordCompletedPull(db, job, pullId, 0, scoreResult.playersPenalized);
    return;
  }

  const report = await reportFromSnapshot(db, pull);
  const fight = report.fights.find((candidate) => candidate.id === pull.fight_id);
  if (!fight) throw new Error(`Pull ${pull.pull_number} is no longer available in Warcraft Logs report ${pull.code}.`);
  const playerResult = await db.prepare("SELECT pp.player_id, p.name, p.realm, p.role FROM pull_players pp JOIN players p ON p.id = pp.player_id WHERE pp.pull_id = ?")
    .bind(pull.id).all<PullPlayerRow>();
  const byIdentity = new Map(playerResult.results.map((player) => [`${player.name.toLowerCase()}|${player.realm.toLowerCase()}`, player]));
  const byName = new Map(playerResult.results.map((player) => [player.name.toLowerCase(), player]));
  const actors = report.masterData?.actors ?? [];
  const participantIds = new Map<number, string>();
  const participantRoles = new Map<string, string>();
  for (const actorId of fight.friendlyPlayers ?? []) {
    const actor = actors.find((candidate) => candidate.id === actorId);
    if (!actor) continue;
    const player = byIdentity.get(`${actor.name.toLowerCase()}|${(actor.server ?? "").toLowerCase()}`) ?? byName.get(actor.name.toLowerCase());
    if (!player) continue;
    participantIds.set(actorId, player.player_id);
    participantRoles.set(player.player_id, player.role);
  }
  const abilities = new Map((report.masterData?.abilities ?? []).map((ability) => [ability.gameID, { name: ability.name, icon: ability.icon }]));
  const iconUpdates = [...abilities.entries()].filter(([, ability]) => Boolean(ability.icon)).map(([spellId, ability]) => db.prepare("UPDATE mechanic_rules SET icon = ? WHERE spell_id = ?").bind(ability.icon, spellId));
  if (iconUpdates.length) await db.batch(iconUpdates);
  const token = await getWarcraftLogsAccessToken(credentials());
  const eventRows = await fetchRuleEvents(pull.code, [fight.id], scoredRules.map((rule) => ({ spellId: rule.spell_id, eventType: rule.event_type })), token);
  const analyzed = await analyzeFightRules({
    db,
    bossId: job.boss_id,
    reportCode: pull.code,
    fight,
    pullId: pull.id,
    token,
    rules: analysisRules,
    participantIds,
    participantRoles,
    abilities,
    contextEvents: { deaths: [], interrupts: [], dispels: [] },
    eventPages: groupRuleEventsByAbility(eventRows, scoredRules.map((rule) => rule.spell_id)),
    resetExisting: job.mode === "full",
    replaceRuleIds: job.mode === "changed" ? targetRules.map((rule) => rule.id) : [],
    stateRules: targetRules,
  });
  await recordCompletedPull(db, job, pullId, analyzed.eventRows, analyzed.playersPenalized);
}

async function processJob(db: D1Database, jobId: string) {
  let job = await readJob(db, jobId);
  if (!job) return { missing: true as const };
  if (job.status === "completed" || job.status === "stopped") return { job: publicJob(job) };
  if (job.cancel_requested) {
    await db.prepare("UPDATE reanalysis_jobs SET status = 'stopped', current_label = 'Stopped safely', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id).run();
    const stopped = await readJob(db, job.id);
    return stopped ? { job: publicJob(stopped) } : { missing: true as const };
  }
  if (job.status === "paused" && job.resume_after && timestamp(job.resume_after) > Date.now()) return { job: publicJob(job), rateLimited: true };
  const claim = await db.prepare("UPDATE reanalysis_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND cancel_requested = 0 AND (status IN ('queued', 'paused', 'failed') OR (status = 'processing' AND updated_at < datetime('now', '-2 minutes')))")
    .bind(jobId).run();
  if (!claim.meta.changes) return { job: publicJob(job), busy: true };
  job = await readJob(db, jobId);
  if (!job) return { missing: true as const };
  try {
    await processPull(db, job);
  } catch (error) {
    if (error instanceof WarcraftLogsRateLimitError) {
      const retry = Math.max(1, error.retryAfterSeconds ?? 300);
      await db.prepare("UPDATE reanalysis_jobs SET status = 'paused', current_label = 'Paused safely', error_message = ?, retry_after_seconds = ?, resume_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(error.message, retry, new Date(Date.now() + retry * 1000).toISOString(), job.id).run();
    } else {
      await db.prepare("UPDATE reanalysis_jobs SET status = 'failed', current_label = 'Needs attention', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(error instanceof Error ? error.message : "That pull could not be recalculated.", job.id).run();
    }
  }
  const refreshed = await readJob(db, jobId);
  return refreshed ? { job: publicJob(refreshed), rateLimited: refreshed.status === "paused" } : { missing: true as const };
}

async function stopJob(db: D1Database, jobId: string) {
  const job = await readJob(db, jobId);
  if (!job) return null;
  if (job.status === "completed") return job;
  if (job.status === "processing") {
    await db.prepare("UPDATE reanalysis_jobs SET cancel_requested = 1, current_label = 'Stopping after current pull…', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(jobId).run();
  } else {
    await db.prepare("UPDATE reanalysis_jobs SET cancel_requested = 1, status = 'stopped', current_label = 'Stopped safely', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(jobId).run();
  }
  return readJob(db, jobId);
}

async function resumeJob(db: D1Database, jobId: string) {
  const job = await readJob(db, jobId);
  if (!job) return null;
  if (job.status === "stopped") {
    await db.prepare("UPDATE reanalysis_jobs SET cancel_requested = 0, status = 'queued', current_label = ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(`${job.boss_name} · ${difficultyNames[job.difficulty] ?? "Unknown"} pull ${job.completed_pulls + 1} of ${job.total_pulls}`, jobId).run();
  }
  return readJob(db, jobId);
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    const url = new URL(request.url);
    const bossId = url.searchParams.get("bossId");
    const difficulty = url.searchParams.get("difficulty");
    return Response.json({ jobs: await activeJobs(db), plan: bossId && difficulty ? await buildPlan(db, bossId, difficulty) : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Saved recalculations could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { action?: "start" | "process" | "stop" | "resume"; mode?: JobMode; bossId?: string; difficulty?: string; jobId?: string };
    const db = await ensureSchema();
    if (payload.action === "start" && payload.bossId && payload.difficulty) {
      const result = await startJob(db, payload.bossId, payload.difficulty, payload.mode === "full" ? "full" : "changed");
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }
    if (payload.action === "process" && payload.jobId) {
      const result = await processJob(db, payload.jobId);
      if ("missing" in result) return Response.json({ error: "That saved recalculation no longer exists." }, { status: 404 });
      return Response.json(result);
    }
    if (payload.action === "stop" && payload.jobId) {
      const job = await stopJob(db, payload.jobId);
      if (!job) return Response.json({ error: "That saved recalculation no longer exists." }, { status: 404 });
      return Response.json({ job: publicJob(job) });
    }
    if (payload.action === "resume" && payload.jobId) {
      const job = await resumeJob(db, payload.jobId);
      if (!job) return Response.json({ error: "That saved recalculation no longer exists." }, { status: 404 });
      return Response.json({ job: publicJob(job) });
    }
    return Response.json({ error: "Choose a recalculation action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The recalculation could not be updated." }, { status: 500 });
  }
}
