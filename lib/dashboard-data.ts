import { ensureSchema } from "../db/runtime";
import type { DashboardData, MechanicRule, PlayerSnapshot, RaidEvent, ScoreKey } from "./types";

type ReportRow = {
  id: string;
  code: string;
  url: string;
  title: string;
  zone_name: string | null;
  start_time: number;
  season_name: string;
  raid_night: string;
};

type PullRow = {
  id: string;
  boss_id: string;
  boss_name: string;
  fight_id: number;
  pull_number: number;
  difficulty: number | null;
  killed: number;
  start_time: number;
  end_time: number;
  boss_percentage: number | null;
};

type PullPlayerRow = {
  pull_id: string;
  boss_id: string;
  player_id: string;
  name: string;
  realm: string;
  class_name: string;
  role: string;
  spec: string;
  parse: number;
  ilvl_parse: number;
  mechanics_score: number;
  performance_score: number;
  attendance_score: number;
  preparation_score: number;
};

type EventRow = {
  id: string;
  pull_id: string;
  player_id: string | null;
  spell_id: number;
  event_type: string;
  timestamp: number;
  amount: number | null;
  outcome: string;
  details_json: string;
};

type RuleRow = {
  id: string;
  boss_id: string;
  spell_id: number;
  name: string;
  category: string;
  severity: string;
  weight: number;
  event_type: string;
  difficulties_json: string;
  roles_json: string;
  condition_json: string;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function duration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function eventTime(timestamp: number, pullStart: number) {
  return duration(timestamp > pullStart ? timestamp - pullStart : timestamp);
}

function average(players: PlayerSnapshot[], key: ScoreKey) {
  const values = players.map((player) => player.scores[key]).filter((value): value is number => value !== null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

export async function loadLatestDashboardData(): Promise<DashboardData | null> {
  const db = await ensureSchema();
  const report = await db.prepare(`
    SELECT r.id, r.code, r.url, r.title, r.zone_name, r.start_time,
           s.name AS season_name, rn.name AS raid_night
    FROM reports r
    JOIN raid_nights rn ON rn.id = r.raid_night_id
    JOIN seasons s ON s.id = rn.season_id
    WHERE r.source_mode = 'live'
    ORDER BY r.imported_at DESC, r.start_time DESC
    LIMIT 1
  `).first<ReportRow>();
  if (!report) return null;

  const [pullResult, playerResult, eventResult, ruleResult] = await Promise.all([
    db.prepare(`
      SELECT pu.id, pu.boss_id, b.name AS boss_name, pu.fight_id, pu.pull_number, pu.difficulty,
             pu.killed, pu.start_time, pu.end_time, pu.boss_percentage
      FROM pulls pu JOIN bosses b ON b.id = pu.boss_id
      WHERE pu.report_id = ? ORDER BY pu.start_time DESC
    `).bind(report.id).all<PullRow>(),
    db.prepare(`
      SELECT pp.pull_id, pu.boss_id, pp.player_id, p.name, p.realm, p.class_name, p.role, pp.spec,
             pp.parse, pp.ilvl_parse, pp.mechanics_score, pp.performance_score,
             pp.attendance_score, pp.preparation_score
      FROM pull_players pp
      JOIN players p ON p.id = pp.player_id
      JOIN pulls pu ON pu.id = pp.pull_id
      WHERE pu.report_id = ?
      ORDER BY pu.start_time DESC, p.name
    `).bind(report.id).all<PullPlayerRow>(),
    db.prepare(`
      SELECT e.id, e.pull_id, e.player_id, e.spell_id, e.event_type, e.timestamp, e.amount, e.outcome, e.details_json
      FROM events e JOIN pulls pu ON pu.id = e.pull_id
      WHERE pu.report_id = ? ORDER BY e.timestamp
    `).bind(report.id).all<EventRow>(),
    db.prepare(`
      SELECT DISTINCT mr.id, mr.boss_id, mr.spell_id, mr.name, mr.category, mr.severity,
             mr.weight, mr.event_type, mr.difficulties_json, mr.roles_json, mr.condition_json
      FROM mechanic_rules mr JOIN pulls pu ON pu.boss_id = mr.boss_id
      WHERE pu.report_id = ? AND mr.enabled = 1 ORDER BY mr.updated_at DESC
    `).bind(report.id).all<RuleRow>(),
  ]);

  const pullRows = pullResult.results;
  if (!pullRows.length) return null;
  const pullById = new Map(pullRows.map((pull) => [pull.id, pull]));
  const rules: MechanicRule[] = ruleResult.results.map((rule) => ({
    id: rule.id,
    bossId: rule.boss_id,
    spellId: rule.spell_id,
    name: rule.name,
    category: rule.category as MechanicRule["category"],
    severity: rule.severity as MechanicRule["severity"],
    weight: rule.weight,
    eventType: rule.event_type as MechanicRule["eventType"],
    difficulties: parseJson(rule.difficulties_json, []),
    roles: parseJson(rule.roles_json, []),
    condition: parseJson(rule.condition_json, {}),
  }));
  const ruleCountByBoss = new Map<string, number>();
  rules.forEach((rule) => ruleCountByBoss.set(rule.bossId, (ruleCountByBoss.get(rule.bossId) ?? 0) + 1));

  const pullEvents: Record<string, RaidEvent[]> = {};
  for (const row of eventResult.results) {
    if (!row.player_id) continue;
    const pull = pullById.get(row.pull_id);
    if (!pull) continue;
    const details = parseJson<{ ability?: string; detail?: string }>(row.details_json, {});
    const kind: RaidEvent["kind"] = row.outcome === "death" || row.event_type === "death"
      ? "death"
      : row.outcome === "warning" ? "warning"
      : row.outcome === "utility" || row.event_type === "interrupt" || row.event_type === "dispel" ? "utility"
      : "success";
    (pullEvents[row.pull_id] ??= []).push({
      id: row.id,
      playerId: row.player_id,
      spellId: row.spell_id,
      ability: details.ability ?? `Spell ${row.spell_id}`,
      detail: details.detail ?? "Recorded by Warcraft Logs",
      timestamp: eventTime(row.timestamp, pull.start_time),
      kind,
      amount: row.amount ?? undefined,
    });
  }

  const pullPlayers: Record<string, PlayerSnapshot[]> = {};
  for (const row of playerResult.results) {
    const pull = pullById.get(row.pull_id);
    if (!pull) continue;
    const events = (pullEvents[row.pull_id] ?? []).filter((event) => event.playerId === row.player_id);
    const warnings = events.filter((event) => event.kind === "warning" || event.kind === "death");
    const utilities = events.filter((event) => event.kind === "utility");
    const hasMechanicRules = (ruleCountByBoss.get(row.boss_id) ?? 0) > 0;
    const parse = row.parse > 0 ? Math.round(row.parse) : null;
    const ilvlParse = row.ilvl_parse > 0 ? Math.round(row.ilvl_parse) : null;
    const mechanics = hasMechanicRules ? Math.round(row.mechanics_score) : null;
    const performance = parse !== null ? Math.round(row.performance_score) : null;
    const relatedRows = playerResult.results
      .filter((candidate) => candidate.player_id === row.player_id && candidate.boss_id === row.boss_id)
      .reverse()
      .slice(-6);
    const trend = relatedRows.map((candidate) => Math.round(candidate.mechanics_score));
    const firstWarning = warnings[0];
    const role = (["Tank", "Healer", "DPS"].includes(row.role) ? row.role : "DPS") as PlayerSnapshot["role"];
    const metric = role === "Healer" ? "healing" : "damage";
    const snapshot: PlayerSnapshot = {
      id: row.player_id,
      name: row.name,
      realm: row.realm,
      className: row.class_name,
      spec: row.spec,
      role,
      scores: {
        mechanics,
        performance,
        attendance: Math.round(row.attendance_score),
        preparation: row.preparation_score > 0 ? Math.round(row.preparation_score) : null,
      },
      parse,
      ilvlParse,
      attendanceLabel: "Present this night",
      prepLabel: "Not evaluated",
      trend: hasMechanicRules ? trend : [],
      summary: hasMechanicRules
        ? `${warnings.length} configured mechanic finding${warnings.length === 1 ? "" : "s"}. ${parse === null ? "This pull has no ranked parse." : `Warcraft Logs shows a ${parse}th percentile ${metric} parse.`}`
        : `Warcraft Logs imported this pull successfully. Add boss rules to calculate Mechanics${parse === null ? "." : `; the ${metric} parse is ${parse}th percentile.`}`,
      wins: [
        warnings.length === 0 ? "No configured mechanic failures were found" : `${Math.max(0, events.length - warnings.length)} clean or useful tracked events`,
        utilities.length ? `${utilities.length} interrupt or dispel event${utilities.length === 1 ? "" : "s"} recorded` : "Roster presence confirmed",
      ],
      focus: [firstWarning?.detail ?? (hasMechanicRules ? "No immediate mechanic correction from the active rules" : "Configure this boss using Wipefest before judging mechanics")],
      deaths: events.filter((event) => event.kind === "death").length,
      interrupts: events.filter((event) => /interrupt/i.test(event.ability) || /interrupt/i.test(event.detail)).length,
      dispels: events.filter((event) => /dispel|removed/i.test(event.ability) || /dispel|removed/i.test(event.detail)).length,
      avoidableDamage: events.filter((event) => event.kind === "warning").reduce((sum, event) => sum + (event.amount ?? 0), 0),
    };
    (pullPlayers[row.pull_id] ??= []).push(snapshot);
  }

  const pulls = pullRows.map((pull) => ({
    id: pull.id,
    bossId: pull.boss_id,
    label: `Pull ${pull.pull_number} · ${pull.killed ? "Kill" : pull.boss_percentage !== null ? `${pull.boss_percentage.toFixed(1)}%` : "Wipe"}`,
    killed: Boolean(pull.killed),
    duration: duration(pull.end_time - pull.start_time),
    difficulty: difficultyNames[pull.difficulty ?? 0] ?? "Unknown",
  }));
  const bosses = [...new Map(pullRows.map((pull) => [pull.boss_id, { id: pull.boss_id, name: pull.boss_name }])).values()];
  const firstPullId = pulls[0].id;
  const players = pullPlayers[firstPullId] ?? [];
  const raidAverages = {
    mechanics: average(players, "mechanics"),
    performance: average(players, "performance"),
    attendance: average(players, "attendance"),
    preparation: average(players, "preparation"),
  };

  return {
    season: report.season_name,
    raidNight: report.raid_night,
    reportCode: report.code,
    raid: report.zone_name ?? report.title,
    bosses,
    pulls,
    players,
    events: pullEvents[firstPullId] ?? [],
    pullPlayers,
    pullEvents,
    rules,
    raidAverages,
    dataSource: {
      label: "Live Warcraft Logs import",
      detail: `${pulls.length} pulls imported from the full report`,
      reportUrl: report.url,
    },
    preparationSummary: "Warcraft Logs does not provide a complete individual food, flask, enchant, and potion score through this import yet.",
    preparationRaid: { flasks: null, food: null, total: players.length },
  };
}
