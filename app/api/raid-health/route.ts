import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type PullRow = {
  id: string;
  boss_id: string;
  boss_name: string;
  difficulty: number | null;
  killed: number;
  imported_at: string;
  active_player_rows: number;
  missing_performance_rows: number;
};

type RuleRow = {
  id: string;
  boss_id: string;
  name: string;
  category: string;
  difficulties_json: string;
  condition_json: string;
  enabled: number;
  updated_at: string;
};

type StateRow = { pull_id: string; rule_id: string; rule_updated_at: string };
type EventCountRow = { pull_id: string; rule_id: string; matches: number };
type PlayerRow = { id: string; name: string; included: number; first_happened_at: string };
type JobRow = { status: string; report_code: string; completed_pulls: number; total_pulls: number };

type HealthAction = {
  view: "configure" | "officer";
  section?: "raid-data" | "people" | "scoring";
  bossId?: string;
  difficulty?: "Normal" | "Heroic" | "Mythic";
  label: string;
};

type HealthIssue = {
  id: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
  action?: HealthAction;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function parseJson<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoringMode(rule: RuleRow) {
  const configured = parseJson<{ scoringMode?: string }>(rule.condition_json, {}).scoringMode;
  return configured ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
}

function ruleApplies(rule: RuleRow, difficulty: string) {
  const difficulties = parseJson<string[]>(rule.difficulties_json, []);
  return difficulties.length === 0 || difficulties.includes(difficulty);
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const raidNightId = new URL(request.url).searchParams.get("raidNightId");
    if (!raidNightId) return Response.json({ error: "Choose a raid night to check." }, { status: 400 });

    const db = await ensureSchema();
    const night = await db.prepare("SELECT id, name, happened_at, included FROM raid_nights WHERE id = ?")
      .bind(raidNightId).first<{ id: string; name: string; happened_at: string; included: number }>();
    if (!night) return Response.json({ error: "That raid night no longer exists." }, { status: 404 });

    const [reportRows, pullRows, ruleRows, stateRows, eventRows, playerRows, jobRows] = await Promise.all([
      db.prepare("SELECT id FROM reports WHERE raid_night_id = ? AND source_mode = 'live' AND included = 1").bind(raidNightId).all<{ id: string }>(),
      db.prepare(`
        SELECT pu.id, pu.boss_id, b.name AS boss_name, pu.difficulty, pu.killed, r.imported_at,
               COUNT(CASE WHEN COALESCE(prs.included, 1) = 1 THEN pp.id END) AS active_player_rows,
               SUM(CASE WHEN COALESCE(prs.included, 1) = 1 AND pp.parse <= 0 THEN 1 ELSE 0 END) AS missing_performance_rows
        FROM pulls pu
        JOIN reports r ON r.id = pu.report_id
        JOIN bosses b ON b.id = pu.boss_id
        LEFT JOIN pull_players pp ON pp.pull_id = pu.id
        LEFT JOIN player_roster_settings prs ON prs.player_id = pp.player_id
        WHERE r.raid_night_id = ? AND r.source_mode = 'live' AND r.included = 1 AND pu.included = 1
        GROUP BY pu.id, pu.boss_id, b.name, pu.difficulty, pu.killed, r.imported_at
        ORDER BY pu.start_time
      `).bind(raidNightId).all<PullRow>(),
      db.prepare("SELECT id, boss_id, name, category, difficulties_json, condition_json, enabled, updated_at FROM mechanic_rules").all<RuleRow>(),
      db.prepare(`
        SELECT ras.pull_id, ras.rule_id, ras.rule_updated_at
        FROM rule_analysis_state ras
        JOIN pulls pu ON pu.id = ras.pull_id
        JOIN reports r ON r.id = pu.report_id
        WHERE r.raid_night_id = ? AND r.source_mode = 'live' AND r.included = 1 AND pu.included = 1
      `).bind(raidNightId).all<StateRow>(),
      db.prepare(`
        SELECT e.pull_id, e.rule_id, COUNT(*) AS matches
        FROM events e
        JOIN pulls pu ON pu.id = e.pull_id
        JOIN reports r ON r.id = pu.report_id
        WHERE r.raid_night_id = ? AND r.source_mode = 'live' AND r.included = 1 AND pu.included = 1 AND e.rule_id IS NOT NULL
        GROUP BY e.pull_id, e.rule_id
      `).bind(raidNightId).all<EventCountRow>(),
      db.prepare(`
        SELECT p.id, p.name, COALESCE(prs.included, 1) AS included, MIN(all_rn.happened_at) AS first_happened_at
        FROM players p
        JOIN pull_players current_pp ON current_pp.player_id = p.id
        JOIN pulls current_pu ON current_pu.id = current_pp.pull_id AND current_pu.included = 1
        JOIN reports current_r ON current_r.id = current_pu.report_id AND current_r.source_mode = 'live' AND current_r.included = 1
        LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
        LEFT JOIN pull_players all_pp ON all_pp.player_id = p.id
        LEFT JOIN pulls all_pu ON all_pu.id = all_pp.pull_id AND all_pu.included = 1
        LEFT JOIN reports all_r ON all_r.id = all_pu.report_id AND all_r.source_mode = 'live' AND all_r.included = 1
        LEFT JOIN raid_nights all_rn ON all_rn.id = all_r.raid_night_id AND all_rn.included = 1
        WHERE current_r.raid_night_id = ?
        GROUP BY p.id, p.name, COALESCE(prs.included, 1)
        ORDER BY p.name
      `).bind(raidNightId).all<PlayerRow>(),
      db.prepare("SELECT status, report_code, completed_pulls, total_pulls FROM import_jobs WHERE raid_night_id = ? ORDER BY created_at DESC").bind(raidNightId).all<JobRow>(),
    ]);

    const pulls = pullRows.results;
    const activePlayers = playerRows.results.filter((player) => Boolean(player.included));
    const firstTimePlayers = activePlayers.filter((player) => player.first_happened_at === night.happened_at);
    const state = new Map(stateRows.results.map((row) => [`${row.pull_id}:${row.rule_id}`, row]));
    const matches = new Map(eventRows.results.map((row) => [`${row.pull_id}:${row.rule_id}`, Number(row.matches)]));
    const groups = new Map<string, { bossId: string; bossName: string; difficulty: string; pulls: PullRow[] }>();

    for (const pull of pulls) {
      const difficulty = difficultyNames[pull.difficulty ?? 0] ?? "Unknown";
      const key = `${pull.boss_id}:${difficulty}`;
      const group = groups.get(key) ?? { bossId: pull.boss_id, bossName: pull.boss_name, difficulty, pulls: [] };
      group.pulls.push(pull);
      groups.set(key, group);
    }

    const issues: HealthIssue[] = [];
    const unfinishedJobs = jobRows.results.filter((job) => job.status !== "completed");
    if (unfinishedJobs.length) issues.push({
      id: "unfinished-imports", severity: "warning", title: "An import is not fully complete",
      detail: `${unfinishedJobs.length} report import${unfinishedJobs.length === 1 ? "" : "s"} stopped before every selected pull was finalized.`,
      action: { view: "configure", section: "raid-data", label: "Open raid data" },
    });

    const bossHealth = [...groups.values()].map((group) => {
      const groupRules = ruleRows.results.filter((rule) => Boolean(rule.enabled) && rule.boss_id === group.bossId && ruleApplies(rule, group.difficulty) && scoringMode(rule) !== "context");
      const matchedRules = groupRules.filter((rule) => group.pulls.some((pull) => (matches.get(`${pull.id}:${rule.id}`) ?? 0) > 0));
      const zeroMatchRules = groupRules.filter((rule) => group.pulls.every((pull) => (matches.get(`${pull.id}:${rule.id}`) ?? 0) === 0));
      const staleRuleIds = new Set<string>();
      for (const rule of groupRules) {
        for (const pull of group.pulls) {
          const analyzed = state.get(`${pull.id}:${rule.id}`);
          if (analyzed && timestamp(analyzed.rule_updated_at) >= timestamp(rule.updated_at)) continue;
          if (timestamp(pull.imported_at) >= timestamp(rule.updated_at)) continue;
          staleRuleIds.add(rule.id);
        }
      }
      const missingPerformanceRows = group.pulls.reduce((total, pull) => total + Number(pull.missing_performance_rows), 0);
      const activePlayerRows = group.pulls.reduce((total, pull) => total + Number(pull.active_player_rows), 0);
      const difficulty = (["Normal", "Heroic", "Mythic"].includes(group.difficulty) ? group.difficulty : undefined) as HealthAction["difficulty"];
      const ruleAction: HealthAction = { view: "configure", section: "scoring", bossId: group.bossId, difficulty, label: "Review boss rules" };

      if (!groupRules.length) issues.push({ id: `rules-${group.bossId}-${group.difficulty}`, severity: "warning", title: `${group.bossName} ${group.difficulty} has no active scoring rules`, detail: "The pulls imported, but Mechanics cannot be meaningfully calibrated for this boss and difficulty yet.", action: ruleAction });
      if (staleRuleIds.size) issues.push({ id: `stale-${group.bossId}-${group.difficulty}`, severity: "warning", title: `${group.bossName} has scores behind its current rules`, detail: `${staleRuleIds.size} rule${staleRuleIds.size === 1 ? "" : "s"} changed after at least one selected pull was analyzed.`, action: ruleAction });
      if (groupRules.length && zeroMatchRules.length) issues.push({ id: `matches-${group.bossId}-${group.difficulty}`, severity: "warning", title: `${group.bossName} has ${zeroMatchRules.length} rule${zeroMatchRules.length === 1 ? "" : "s"} with zero matches`, detail: `Nothing matched ${zeroMatchRules.slice(0, 3).map((rule) => rule.name).join(", ")}${zeroMatchRules.length > 3 ? ", and more" : ""}. That can be a clean pull, but it is worth checking the Spell ID and event type.`, action: ruleAction });

      return {
        bossId: group.bossId,
        bossName: group.bossName,
        difficulty: group.difficulty,
        pulls: group.pulls.length,
        kills: group.pulls.filter((pull) => Boolean(pull.killed)).length,
        activeRules: groupRules.length,
        matchedRules: matchedRules.length,
        zeroMatchRules: zeroMatchRules.length,
        staleRules: staleRuleIds.size,
        missingPerformanceRows,
        status: !groupRules.length || staleRuleIds.size || zeroMatchRules.length ? "review" : "ready",
        activePlayerRows,
      };
    });

    const totalPlayerRows = bossHealth.reduce((total, boss) => total + boss.activePlayerRows, 0);
    const missingPerformanceRows = bossHealth.reduce((total, boss) => total + boss.missingPerformanceRows, 0);
    if (totalPlayerRows && missingPerformanceRows / totalPlayerRows > 0.25) issues.push({ id: "performance", severity: "warning", title: "A large share of performance parses is missing", detail: `${missingPerformanceRows} of ${totalPlayerRows} active player-pull rows have no Warcraft Logs parse. Mechanics data may still be complete.`, action: { view: "officer", label: "Open Officer View" } });
    else if (missingPerformanceRows) issues.push({ id: "performance", severity: "info", title: "A few performance parses are unavailable", detail: `${missingPerformanceRows} active player-pull row${missingPerformanceRows === 1 ? " has" : "s have"} no Warcraft Logs parse.`, action: { view: "officer", label: "Open Officer View" } });

    if (firstTimePlayers.length) issues.push({ id: "new-roster", severity: "info", title: `${firstTimePlayers.length} active character${firstTimePlayers.length === 1 ? " is" : "s are"} new to the stored season`, detail: `${firstTimePlayers.slice(0, 5).map((player) => player.name).join(", ")}${firstTimePlayers.length > 5 ? ", and more" : ""}. Confirm regular raiders, guests, and alternate characters before using attendance.`, action: { view: "configure", section: "people", label: "Review roster & alts" } });

    if (!night.included) issues.push({ id: "excluded-night", severity: "warning", title: "This raid night is excluded", detail: "Its data is saved but it will not appear in player dashboards, officer history, or attendance.", action: { view: "configure", section: "raid-data", label: "Open raid data" } });
    if (!pulls.length) issues.push({ id: "no-pulls", severity: "warning", title: "No active pulls are available", detail: "The report may be incomplete, excluded, or contain no selected raid encounters.", action: { view: "configure", section: "raid-data", label: "Open raid data" } });

    const warningCount = issues.filter((issue) => issue.severity === "warning").length;
    const checks = [
      { id: "imports", label: "Import completed", detail: unfinishedJobs.length ? `${unfinishedJobs.length} unfinished import${unfinishedJobs.length === 1 ? "" : "s"}` : `${jobRows.results.filter((job) => job.status === "completed").length} report job${jobRows.results.filter((job) => job.status === "completed").length === 1 ? "" : "s"} finalized`, status: unfinishedJobs.length ? "warning" : "pass" },
      { id: "pulls", label: "Pulls stored", detail: `${pulls.length} active pull${pulls.length === 1 ? "" : "s"} across ${groups.size} boss stage${groups.size === 1 ? "" : "s"}`, status: pulls.length ? "pass" : "warning" },
      { id: "rules", label: "Boss rules covered", detail: bossHealth.every((boss) => boss.activeRules > 0) ? "Every imported boss stage has active scoring rules" : "At least one boss stage needs scoring rules", status: bossHealth.length && bossHealth.every((boss) => boss.activeRules > 0) ? "pass" : "warning" },
      { id: "freshness", label: "Scores match current rules", detail: bossHealth.every((boss) => boss.staleRules === 0) ? "No saved scores are behind a rule change" : "A changed rule still needs to be applied", status: bossHealth.every((boss) => boss.staleRules === 0) ? "pass" : "warning" },
      { id: "matches", label: "Rules returned evidence", detail: bossHealth.every((boss) => boss.zeroMatchRules === 0) ? "Every active scoring rule matched at least once" : "Some rules returned zero matches and deserve a spot check", status: bossHealth.every((boss) => boss.zeroMatchRules === 0) ? "pass" : "warning" },
      { id: "performance", label: "Performance context loaded", detail: missingPerformanceRows ? `${missingPerformanceRows} of ${totalPlayerRows} player-pull parses are unavailable` : "Every active player-pull row has a parse", status: totalPlayerRows && missingPerformanceRows / totalPlayerRows > 0.25 ? "warning" : missingPerformanceRows ? "info" : "pass" },
    ] as const;

    return Response.json({
      health: {
        raidNight: { id: night.id, name: night.name, happenedAt: night.happened_at },
        status: warningCount ? "review" : "ready",
        summary: { reports: reportRows.results.length, pulls: pulls.length, bosses: groups.size, players: activePlayers.length, checksPassed: checks.filter((check) => check.status === "pass").length, checksTotal: checks.length },
        checks,
        issues,
        bosses: bossHealth.map((boss) => ({
          bossId: boss.bossId,
          bossName: boss.bossName,
          difficulty: boss.difficulty,
          pulls: boss.pulls,
          kills: boss.kills,
          activeRules: boss.activeRules,
          matchedRules: boss.matchedRules,
          zeroMatchRules: boss.zeroMatchRules,
          staleRules: boss.staleRules,
          missingPerformanceRows: boss.missingPerformanceRows,
          status: boss.status,
        })),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The raid night health check could not be completed." }, { status: 500 });
  }
}
