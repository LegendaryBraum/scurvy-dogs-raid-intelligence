import { ensureSchema } from "../db/runtime";
import type { DashboardData, MechanicRule, ModuleSettings, PlayerSnapshot, RaidEvent, RosterMember, ScoreKey } from "./types";

type ReportRow = {
  id: string;
  raid_night_id: string;
  season_id: string;
  code: string;
  url: string;
  title: string;
  zone_name: string | null;
  start_time: number;
  season_name: string;
  raid_night: string;
  happened_at: string;
};

type RosterRow = {
  player_id: string;
  name: string;
  realm: string;
  class_name: string;
  role: string;
  spec: string;
  pulls_seen: number;
  raid_nights: number;
  last_seen: number | null;
  included: number;
  identity_id: string;
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
  identity_id: string;
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
  icon: string | null;
  category: string;
  severity: string;
  weight: number;
  event_type: string;
  difficulties_json: string;
  roles_json: string;
  condition_json: string;
  enabled: number;
};

type ModuleRow = { module_key: string; enabled: number };
type RaidNightRow = { id: string; name: string; happened_at: string; report_count: number };
type AttendanceRow = { identity_id: string; nights: number };
type ConfigBossRow = { id: string; name: string; encounter_id: number };

const defaultModuleSettings: ModuleSettings = { mechanics: true, performance: true, attendance: true, preparation: false };

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

export async function loadLatestDashboardData(selectedRaidNightId?: string | null): Promise<DashboardData | null> {
  const db = await ensureSchema();
  const reportStatement = db.prepare(`
    SELECT r.id, r.raid_night_id, rn.season_id, r.code, r.url, r.title, r.zone_name, r.start_time,
           s.name AS season_name, rn.name AS raid_night, rn.happened_at
    FROM reports r
    JOIN raid_nights rn ON rn.id = r.raid_night_id
    JOIN seasons s ON s.id = rn.season_id
    WHERE r.source_mode = 'live' AND r.included = 1 AND rn.included = 1
      AND EXISTS (SELECT 1 FROM pulls active_pu WHERE active_pu.report_id = r.id AND active_pu.included = 1)
      AND (? IS NULL OR rn.id = ?)
    ORDER BY r.imported_at DESC, r.start_time DESC
    LIMIT 1
  `).bind(selectedRaidNightId ?? null, selectedRaidNightId ?? null);
  const report = await reportStatement.first<ReportRow>();
  if (!report) return null;

  const [pullResult, playerResult, eventResult, ruleResult, rosterResult, moduleResult, raidNightResult, attendanceResult, configBossResult] = await Promise.all([
    db.prepare(`
      SELECT pu.id, pu.boss_id, b.name AS boss_name, pu.fight_id, pu.pull_number, pu.difficulty,
             pu.killed, pu.start_time, pu.end_time, pu.boss_percentage
      FROM pulls pu JOIN bosses b ON b.id = pu.boss_id JOIN reports r ON r.id = pu.report_id
      WHERE r.raid_night_id = ? AND r.included = 1 AND pu.included = 1 ORDER BY pu.start_time DESC
    `).bind(report.raid_night_id).all<PullRow>(),
    db.prepare(`
      SELECT pp.pull_id, pu.boss_id, pp.player_id, p.name, p.realm, p.class_name, p.role, pp.spec,
             pp.parse, pp.ilvl_parse, pp.mechanics_score, pp.performance_score,
             pp.attendance_score, pp.preparation_score, COALESCE(pi.identity_id, p.id) AS identity_id
      FROM pull_players pp
      JOIN players p ON p.id = pp.player_id
      LEFT JOIN player_identities pi ON pi.player_id = p.id
      JOIN pulls pu ON pu.id = pp.pull_id
      JOIN reports r ON r.id = pu.report_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE r.raid_night_id = ? AND r.included = 1 AND pu.included = 1 AND COALESCE(prs.included, 1) = 1
      ORDER BY pu.start_time DESC, p.name
    `).bind(report.raid_night_id).all<PullPlayerRow>(),
    db.prepare(`
      SELECT e.id, e.pull_id, e.player_id, e.spell_id, e.event_type, e.timestamp, e.amount, e.outcome, e.details_json
      FROM events e
      JOIN pulls pu ON pu.id = e.pull_id
      JOIN reports r ON r.id = pu.report_id
      LEFT JOIN mechanic_rules mr ON mr.id = e.rule_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = e.player_id
      WHERE r.raid_night_id = ? AND r.included = 1 AND pu.included = 1 AND COALESCE(prs.included, 1) = 1
        AND (e.rule_id IS NULL OR mr.enabled = 1)
      ORDER BY e.timestamp
    `).bind(report.raid_night_id).all<EventRow>(),
    db.prepare(`
      SELECT mr.id, mr.boss_id, mr.spell_id, mr.name, mr.icon, mr.category, mr.severity,
             mr.weight, mr.event_type, mr.difficulties_json, mr.roles_json, mr.condition_json, mr.enabled
      FROM mechanic_rules mr JOIN bosses b ON b.id = mr.boss_id
      WHERE b.season_id = ? ORDER BY mr.enabled DESC, mr.updated_at DESC
    `).bind(report.season_id).all<RuleRow>(),
    db.prepare(`
      SELECT p.id AS player_id, p.name, p.realm, p.class_name, p.role,
             MAX(pp.spec) AS spec,
             COUNT(DISTINCT CASE WHEN pu.included = 1 THEN pp.pull_id END) AS pulls_seen,
             COUNT(DISTINCT CASE WHEN pu.included = 1 THEN r.raid_night_id END) AS raid_nights,
             MAX(CASE WHEN pu.included = 1 THEN r.start_time END) AS last_seen,
             COALESCE(prs.included, 1) AS included,
             COALESCE(pi.identity_id, p.id) AS identity_id
      FROM players p
      JOIN pull_players pp ON pp.player_id = p.id
      JOIN pulls pu ON pu.id = pp.pull_id
      JOIN reports r ON r.id = pu.report_id
      JOIN raid_nights rn ON rn.id = r.raid_night_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      LEFT JOIN player_identities pi ON pi.player_id = p.id
      WHERE rn.season_id = ? AND r.source_mode = 'live' AND rn.included = 1 AND r.included = 1
      GROUP BY p.id, p.name, p.realm, p.class_name, p.role, prs.included, pi.identity_id
      ORDER BY COALESCE(prs.included, 1) DESC, p.name
    `).bind(report.season_id).all<RosterRow>(),
    db.prepare("SELECT module_key, enabled FROM score_module_settings").all<ModuleRow>(),
    db.prepare(`
      SELECT rn.id, rn.name, rn.happened_at, COUNT(DISTINCT r.id) AS report_count
      FROM raid_nights rn
      JOIN reports r ON r.raid_night_id = rn.id
      JOIN pulls active_pu ON active_pu.report_id = r.id AND active_pu.included = 1
      WHERE rn.season_id = ? AND rn.included = 1 AND r.included = 1 AND r.source_mode = 'live'
      GROUP BY rn.id, rn.name, rn.happened_at ORDER BY rn.happened_at DESC
    `).bind(report.season_id).all<RaidNightRow>(),
    db.prepare(`
      SELECT COALESCE(pi.identity_id, p.id) AS identity_id, COUNT(DISTINCT r.raid_night_id) AS nights
      FROM players p
      JOIN pull_players pp ON pp.player_id = p.id
      JOIN pulls pu ON pu.id = pp.pull_id
      JOIN reports r ON r.id = pu.report_id
      JOIN raid_nights rn ON rn.id = r.raid_night_id
      LEFT JOIN player_identities pi ON pi.player_id = p.id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE rn.season_id = ? AND rn.included = 1 AND r.included = 1 AND pu.included = 1 AND r.source_mode = 'live' AND COALESCE(prs.included, 1) = 1
      GROUP BY COALESCE(pi.identity_id, p.id)
    `).bind(report.season_id).all<AttendanceRow>(),
    db.prepare(`
      SELECT b.id, b.name, b.encounter_id
      FROM bosses b
      WHERE b.season_id = ?
      ORDER BY b.encounter_id, b.name
    `).bind(report.season_id).all<ConfigBossRow>(),
  ]);

  const pullRows = pullResult.results;
  if (!pullRows.length) return null;
  const pullById = new Map(pullRows.map((pull) => [pull.id, pull]));
  const rules: MechanicRule[] = ruleResult.results.map((rule) => ({
    id: rule.id,
    bossId: rule.boss_id,
    spellId: rule.spell_id,
    name: rule.name,
    icon: rule.icon ?? undefined,
    category: rule.category as MechanicRule["category"],
    severity: rule.severity as MechanicRule["severity"],
    weight: rule.weight,
    eventType: rule.event_type as MechanicRule["eventType"],
    difficulties: parseJson(rule.difficulties_json, []),
    roles: parseJson(rule.roles_json, []),
    condition: parseJson(rule.condition_json, {}),
    enabled: Boolean(rule.enabled),
  }));
  const ruleCountByBoss = new Map<string, number>();
  rules.filter((rule) => rule.enabled).forEach((rule) => ruleCountByBoss.set(rule.bossId, (ruleCountByBoss.get(rule.bossId) ?? 0) + 1));

  const moduleSettings = { ...defaultModuleSettings };
  for (const row of moduleResult.results) {
    if (row.module_key in moduleSettings) moduleSettings[row.module_key as ScoreKey] = Boolean(row.enabled);
  }
  const totalRaidNights = raidNightResult.results.length;
  const attendanceByIdentity = new Map(attendanceResult.results.map((row) => [row.identity_id, totalRaidNights ? Math.round(Number(row.nights) / totalRaidNights * 100) : 0]));

  const pullEvents: Record<string, RaidEvent[]> = {};
  for (const row of eventResult.results) {
    if (!row.player_id) continue;
    const pull = pullById.get(row.pull_id);
    if (!pull) continue;
    const details = parseJson<{ ability?: string; icon?: string; detail?: string }>(row.details_json, {});
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
      icon: details.icon,
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
        attendance: attendanceByIdentity.get(row.identity_id) ?? 0,
        preparation: row.preparation_score > 0 ? Math.round(row.preparation_score) : null,
      },
      parse,
      ilvlParse,
      attendanceLabel: `${attendanceByIdentity.get(row.identity_id) ?? 0}% across ${totalRaidNights} tracked night${totalRaidNights === 1 ? "" : "s"}`,
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

  const pulls = pullRows.map((pull) => {
    const difficulty = difficultyNames[pull.difficulty ?? 0] ?? "Unknown";
    return {
      id: pull.id,
      bossId: pull.boss_id,
      label: `${difficulty} · Pull ${pull.pull_number} · ${pull.killed ? "Kill" : pull.boss_percentage !== null ? `${pull.boss_percentage.toFixed(1)}%` : "Wipe"}`,
      killed: Boolean(pull.killed),
      duration: duration(pull.end_time - pull.start_time),
      difficulty,
    };
  });
  const bosses = [...new Map(pullRows.map((pull) => [pull.boss_id, { id: pull.boss_id, name: pull.boss_name }])).values()];
  const roster: RosterMember[] = rosterResult.results.map((row) => ({
    id: row.player_id,
    name: row.name,
    realm: row.realm,
    className: row.class_name,
    spec: row.spec,
    role: (["Tank", "Healer", "DPS"].includes(row.role) ? row.role : "DPS") as RosterMember["role"],
    pullsSeen: Number(row.pulls_seen),
    raidNights: Number(row.raid_nights),
    lastSeen: row.last_seen === null ? null : Number(row.last_seen),
    included: Boolean(row.included),
    identityId: row.identity_id,
    attendanceScore: attendanceByIdentity.get(row.identity_id) ?? 0,
  }));
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
    raidNightId: report.raid_night_id,
    raidNights: raidNightResult.results.map((night) => ({ id: night.id, name: night.name, happenedAt: night.happened_at })),
    reportCode: report.code,
    raid: report.zone_name ?? report.title,
    bosses,
    configBosses: configBossResult.results.map((boss) => ({ id: boss.id, name: boss.name })),
    pulls,
    players,
    roster,
    events: pullEvents[firstPullId] ?? [],
    pullPlayers,
    pullEvents,
    rules,
    moduleSettings,
    raidAverages,
    dataSource: {
      label: "Live Warcraft Logs import",
      detail: `${pulls.length} pulls across ${raidNightResult.results.find((night) => night.id === report.raid_night_id)?.report_count ?? 1} report${(raidNightResult.results.find((night) => night.id === report.raid_night_id)?.report_count ?? 1) === 1 ? "" : "s"}`,
      reportUrl: report.url,
    },
    preparationSummary: "Warcraft Logs does not provide a complete individual food, flask, enchant, and potion score through this import yet.",
    preparationRaid: { flasks: null, food: null, total: players.length },
  };
}
