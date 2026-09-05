import { ensureSchema, getRuntimeEnv, makeId } from "../../../db/runtime";
import { analyzeFightRules, type StoredRule } from "../../../lib/rule-analysis";
import { fetchReportOverview, fetchRuleEvents, groupRuleEventsByAbility, type WarcraftLogsCredentials, WarcraftLogsRateLimitError } from "../../../lib/warcraft-logs";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type JobStatus = "queued" | "processing" | "paused" | "failed" | "completed";
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
};

type PullRow = {
  id: string;
  report_id: string;
  fight_id: number;
  pull_number: number;
  difficulty: number;
  start_time: number;
  end_time: number;
  code: string;
  boss_name: string;
};

type PullPlayerRow = { player_id: string; name: string; realm: string; role: string };

const difficultyIds: Record<string, number> = { Normal: 3, Heroic: 4, Mythic: 5 };
const difficultyNames: Record<number, string> = { 3: "Normal", 4: "Heroic", 5: "Mythic" };
const activeStatuses = "'queued', 'processing', 'paused', 'failed'";

function parseJson<T>(value: string | null, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function credentials(): WarcraftLogsCredentials {
  const runtimeEnv = getRuntimeEnv();
  if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) throw new Error("The Warcraft Logs connection is not available.");
  return { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };
}
function ruleApplies(rule: StoredRule, difficulty: string) {
  const difficulties = parseJson<string[]>(rule.difficulties_json, []);
  return difficulties.length === 0 || difficulties.includes(difficulty);
}
function publicJob(job: ReanalysisJobRow) {
  return {
    id: job.id,
    bossId: job.boss_id,
    bossName: job.boss_name,
    difficulty: difficultyNames[job.difficulty] ?? "Unknown",
    status: job.status,
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
  const jobs = await db.prepare(`SELECT rj.*, b.name AS boss_name FROM reanalysis_jobs rj JOIN bosses b ON b.id = rj.boss_id WHERE rj.status IN (${activeStatuses}) ORDER BY rj.updated_at DESC`)
    .all<ReanalysisJobRow>();
  return jobs.results.map(publicJob);
}

async function plan(db: D1Database, bossId: string, difficulty: string) {
  const difficultyId = difficultyIds[difficulty];
  if (!difficultyId) return null;
  const boss = await db.prepare("SELECT name FROM bosses WHERE id = ?").bind(bossId).first<{ name: string }>();
  if (!boss) return null;
  const count = await db.prepare("SELECT COUNT(*) AS count FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id WHERE p.boss_id = ? AND p.difficulty = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live'")
    .bind(bossId, difficultyId).first<{ count: number }>();
  const rules = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(bossId).all<StoredRule>();
  return { bossId, bossName: boss.name, difficulty, pullCount: Number(count?.count ?? 0), ruleCount: rules.results.filter((rule) => ruleApplies(rule, difficulty)).length };
}

async function startJob(db: D1Database, bossId: string, difficulty: string) {
  const difficultyId = difficultyIds[difficulty];
  if (!difficultyId) return { error: "Choose Normal, Heroic, or Mythic.", status: 400 } as const;
  credentials();
  const boss = await db.prepare("SELECT name FROM bosses WHERE id = ?").bind(bossId).first<{ name: string }>();
  if (!boss) return { error: "That boss is no longer available.", status: 404 } as const;
  const ruleResult = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1 ORDER BY updated_at").bind(bossId).all<StoredRule>();
  const applicableRules = ruleResult.results.filter((rule) => ruleApplies(rule, difficulty));
  if (!applicableRules.length) return { error: `Add at least one active ${difficulty} rule before recalculating.`, status: 409 } as const;
  const pullResult = await db.prepare("SELECT p.id, p.pull_number FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id WHERE p.boss_id = ? AND p.difficulty = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live' ORDER BY r.start_time, p.fight_id")
    .bind(bossId, difficultyId).all<{ id: string; pull_number: number }>();
  if (!pullResult.results.length) return { error: `No saved ${difficulty} pulls were found for ${boss.name}.`, status: 404 } as const;

  const existing = await db.prepare(`SELECT rj.*, b.name AS boss_name FROM reanalysis_jobs rj JOIN bosses b ON b.id = rj.boss_id WHERE rj.boss_id = ? AND rj.difficulty = ? AND rj.status IN (${activeStatuses}) ORDER BY rj.updated_at DESC LIMIT 1`)
    .bind(bossId, difficultyId).first<ReanalysisJobRow>();
  const pullIds = pullResult.results.map((pull) => pull.id);
  const currentLabel = `${boss.name} · ${difficulty} pull 1 of ${pullIds.length}`;
  if (existing) {
    const running = existing.status === "processing" && Date.parse(`${existing.updated_at}Z`) > Date.now() - 120_000;
    if (running) return { job: publicJob(existing), busy: true } as const;
    await db.prepare("UPDATE reanalysis_jobs SET pull_ids_json = ?, completed_pull_ids_json = '[]', status = 'queued', total_pulls = ?, completed_pulls = 0, current_label = ?, event_rows = 0, players_penalized = 0, rules_count = ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(pullIds), pullIds.length, currentLabel, applicableRules.length, existing.id).run();
    const restarted = await readJob(db, existing.id);
    return { job: restarted ? publicJob(restarted) : publicJob(existing), restarted: true } as const;
  }

  const id = makeId("reanalysis");
  await db.prepare("INSERT INTO reanalysis_jobs (id, boss_id, difficulty, pull_ids_json, total_pulls, current_label, rules_count) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, bossId, difficultyId, JSON.stringify(pullIds), pullIds.length, currentLabel, applicableRules.length).run();
  const job = await readJob(db, id);
  if (!job) return { error: "The recalculation could not be prepared.", status: 500 } as const;
  return { job: publicJob(job) } as const;
}

async function recordCompletedPull(db: D1Database, job: ReanalysisJobRow, pullId: string, events: number, playerScoreUpdates: number, rules: number) {
  const completed = new Set(parseJson<string[]>(job.completed_pull_ids_json, []));
  completed.add(pullId);
  const pullIds = parseJson<string[]>(job.pull_ids_json, []);
  const remaining = pullIds.filter((id) => !completed.has(id));
  const finished = remaining.length === 0;
  await db.prepare("UPDATE reanalysis_jobs SET completed_pull_ids_json = ?, completed_pulls = ?, status = ?, current_label = ?, event_rows = event_rows + ?, players_penalized = players_penalized + ?, rules_count = ?, error_message = NULL, retry_after_seconds = NULL, resume_after = NULL, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(JSON.stringify([...completed]), completed.size, finished ? "completed" : "queued", finished ? "Dashboards updated" : `${job.boss_name} · ${difficultyNames[job.difficulty] ?? "Unknown"} pull ${completed.size + 1} of ${pullIds.length}`, events, playerScoreUpdates, rules, finished ? new Date().toISOString() : null, job.id).run();
}

async function processPull(db: D1Database, job: ReanalysisJobRow) {
  const pullIds = parseJson<string[]>(job.pull_ids_json, []);
  const completed = new Set(parseJson<string[]>(job.completed_pull_ids_json, []));
  const pullId = pullIds.find((id) => !completed.has(id));
  if (!pullId) {
    await db.prepare("UPDATE reanalysis_jobs SET status = 'completed', completed_pulls = total_pulls, current_label = 'Dashboards updated', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id).run();
    return;
  }
  const pull = await db.prepare("SELECT p.id, p.report_id, p.fight_id, p.pull_number, p.difficulty, p.start_time, p.end_time, r.code, b.name AS boss_name FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id JOIN bosses b ON b.id = p.boss_id WHERE p.id = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live'")
    .bind(pullId).first<PullRow>();
  if (!pull) { await recordCompletedPull(db, job, pullId, 0, 0, job.rules_count); return; }

  const difficulty = difficultyNames[job.difficulty] ?? "Unknown";
  const ruleResult = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1 ORDER BY updated_at").bind(job.boss_id).all<StoredRule>();
  const applicableRules = ruleResult.results.filter((rule) => ruleApplies(rule, difficulty));
  if (!applicableRules.length) throw new Error(`No active ${difficulty} rules remain for ${job.boss_name}.`);
  const scoredRules = applicableRules.filter((rule) => parseJson<{ scoringMode?: string }>(rule.condition_json, {}).scoringMode !== "context");
  const { report, token } = await fetchReportOverview(pull.code, credentials());
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
  const eventRows = await fetchRuleEvents(pull.code, [fight.id], scoredRules.map((rule) => ({ spellId: rule.spell_id, eventType: rule.event_type })), token);
  const analyzed = await analyzeFightRules({
    db,
    reportCode: pull.code,
    fight,
    pullId: pull.id,
    token,
    rules: applicableRules,
    participantIds,
    participantRoles,
    abilities,
    contextEvents: { deaths: [], interrupts: [], dispels: [] },
    eventPages: groupRuleEventsByAbility(eventRows, scoredRules.map((rule) => rule.spell_id)),
    resetExisting: true,
  });
  await recordCompletedPull(db, job, pullId, analyzed.eventRows, analyzed.playersPenalized, applicableRules.length);
}

async function processJob(db: D1Database, jobId: string) {
  let job = await readJob(db, jobId);
  if (!job) return { missing: true as const };
  if (job.status === "completed") return { job: publicJob(job) };
  if (job.status === "paused" && job.resume_after && Date.parse(job.resume_after) > Date.now()) return { job: publicJob(job), rateLimited: true };
  const claim = await db.prepare("UPDATE reanalysis_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (status IN ('queued', 'paused', 'failed') OR (status = 'processing' AND updated_at < datetime('now', '-2 minutes')))")
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

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    const url = new URL(request.url);
    const bossId = url.searchParams.get("bossId");
    const difficulty = url.searchParams.get("difficulty");
    return Response.json({ jobs: await activeJobs(db), plan: bossId && difficulty ? await plan(db, bossId, difficulty) : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Saved recalculations could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { action?: "start" | "process"; bossId?: string; difficulty?: string; jobId?: string };
    const db = await ensureSchema();
    if (payload.action === "start" && payload.bossId && payload.difficulty) {
      const result = await startJob(db, payload.bossId, payload.difficulty);
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }
    if (payload.action === "process" && payload.jobId) {
      const result = await processJob(db, payload.jobId);
      if ("missing" in result) return Response.json({ error: "That saved recalculation no longer exists." }, { status: 404 });
      return Response.json(result);
    }
    return Response.json({ error: "Choose a recalculation action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The recalculation could not be updated." }, { status: 500 });
  }
}
