import { ensureSchema, getRuntimeEnv } from "../../../db/runtime";
import { evaluateFightRules, type StoredRule } from "../../../lib/rule-analysis";
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

type PullRow = {
  id: string;
  boss_id: string;
  fight_id: number;
  pull_number: number;
  difficulty: number;
  start_time: number;
  end_time: number;
  killed: number;
  code: string;
  report_title: string;
  boss_name: string;
  raid_night: string;
  happened_at: string;
};

type PlayerRow = {
  player_id: string;
  name: string;
  realm: string;
  role: string;
  mechanics_score: number;
};

type StoredEventRow = { player_id: string; rule_id: string };
type ImportSnapshot = {
  report?: { title?: string; startTime?: number; endTime?: number; zoneName?: string };
  fights?: WclReportOverview["fights"];
  actors?: NonNullable<NonNullable<WclReportOverview["masterData"]>["actors"]>;
  abilities?: NonNullable<NonNullable<WclReportOverview["masterData"]>["abilities"]>;
};
type RuleCondition = { scoringMode?: "penalty" | "success" | "context"; ignoreTanks?: boolean };

const difficultyIds: Record<string, number> = { Normal: 3, Heroic: 4, Mythic: 5 };
const difficultyNames: Record<number, string> = { 3: "Normal", 4: "Heroic", 5: "Mythic" };

function parseJson<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

function durationLabel(startTime: number, endTime: number) {
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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

function isPenaltyRule(rule: StoredRule) {
  const condition = parseJson<RuleCondition>(rule.condition_json, {});
  return (condition.scoringMode ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty")) === "penalty";
}

async function reportFromSnapshot(db: D1Database, pull: PullRow) {
  const row = await db.prepare("SELECT snapshot_json FROM import_jobs WHERE report_code = ? AND status = 'completed' AND snapshot_json IS NOT NULL ORDER BY completed_at DESC LIMIT 1")
    .bind(pull.code).first<{ snapshot_json: string | null }>();
  const snapshot = parseJson<ImportSnapshot>(row?.snapshot_json ?? null, {});
  if (snapshot.fights?.length && snapshot.actors && snapshot.abilities) {
    return {
      code: pull.code,
      title: snapshot.report?.title ?? pull.report_title,
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

async function readPull(db: D1Database, pullId: string) {
  return db.prepare("SELECT p.id, p.boss_id, p.fight_id, p.pull_number, p.difficulty, p.start_time, p.end_time, p.killed, r.code, r.title AS report_title, b.name AS boss_name, rn.name AS raid_night, rn.happened_at FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id JOIN bosses b ON b.id = p.boss_id WHERE p.id = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live'")
    .bind(pullId).first<PullRow>();
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const url = new URL(request.url);
    const bossId = url.searchParams.get("bossId");
    const difficulty = url.searchParams.get("difficulty");
    const difficultyId = difficulty ? difficultyIds[difficulty] : undefined;
    if (!bossId || !difficulty || !difficultyId) return Response.json({ error: "Choose a boss and difficulty to audit." }, { status: 400 });
    const db = await ensureSchema();
    const pulls = await db.prepare("SELECT p.id, p.boss_id, p.fight_id, p.pull_number, p.difficulty, p.start_time, p.end_time, p.killed, r.code, r.title AS report_title, b.name AS boss_name, rn.name AS raid_night, rn.happened_at FROM pulls p JOIN reports r ON r.id = p.report_id JOIN raid_nights rn ON rn.id = r.raid_night_id JOIN bosses b ON b.id = p.boss_id WHERE p.boss_id = ? AND p.difficulty = ? AND p.included = 1 AND r.included = 1 AND rn.included = 1 AND r.source_mode = 'live' ORDER BY rn.happened_at DESC, p.start_time DESC")
      .bind(bossId, difficultyId).all<PullRow>();
    return Response.json({ pulls: pulls.results.map((pull) => ({
      id: pull.id,
      label: `${pull.raid_night} · Pull ${pull.pull_number}`,
      raidNight: pull.raid_night,
      happenedAt: pull.happened_at,
      pullNumber: pull.pull_number,
      result: pull.killed ? "Kill" : "Wipe",
      duration: durationLabel(pull.start_time, pull.end_time),
      reportCode: pull.code,
    })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The available audit pulls could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { bossId?: string; difficulty?: string; pullId?: string; ruleId?: string };
    const difficultyId = payload.difficulty ? difficultyIds[payload.difficulty] : undefined;
    if (!payload.bossId || !payload.pullId || !payload.ruleId || !payload.difficulty || !difficultyId) {
      return Response.json({ error: "Choose one rule and one pull to test." }, { status: 400 });
    }
    const db = await ensureSchema();
    const [pull, selectedRule, ruleResult] = await Promise.all([
      readPull(db, payload.pullId),
      db.prepare("SELECT * FROM mechanic_rules WHERE id = ? AND boss_id = ? AND enabled = 1").bind(payload.ruleId, payload.bossId).first<StoredRule>(),
      db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(payload.bossId).all<StoredRule>(),
    ]);
    if (!pull || pull.boss_id !== payload.bossId || pull.difficulty !== difficultyId) return Response.json({ error: "That pull does not belong to the selected boss and difficulty." }, { status: 404 });
    if (!selectedRule || !ruleApplies(selectedRule, payload.difficulty)) return Response.json({ error: "Choose an active rule for this difficulty." }, { status: 409 });
    if (parseJson<RuleCondition>(selectedRule.condition_json, {}).scoringMode === "context") return Response.json({ error: "Raid-context rules do not create player matches and do not need a scoring audit." }, { status: 409 });

    const report = await reportFromSnapshot(db, pull);
    const fight = report.fights.find((candidate) => candidate.id === pull.fight_id);
    if (!fight) return Response.json({ error: `Pull ${pull.pull_number} is no longer available in report ${pull.code}.` }, { status: 404 });
    const playerResult = await db.prepare("SELECT pp.player_id, p.name, p.realm, p.role, pp.mechanics_score FROM pull_players pp JOIN players p ON p.id = pp.player_id LEFT JOIN player_roster_settings prs ON prs.player_id = p.id WHERE pp.pull_id = ? AND COALESCE(prs.included, 1) = 1 ORDER BY p.name")
      .bind(pull.id).all<PlayerRow>();
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
    const token = await getWarcraftLogsAccessToken(credentials());
    const rawEvents = await fetchRuleEvents(pull.code, [fight.id], [{ spellId: selectedRule.spell_id, eventType: selectedRule.event_type }], token);
    const findings = evaluateFightRules({
      fight,
      rules: [selectedRule],
      participantIds,
      participantRoles,
      abilities,
      contextEvents: { deaths: [], interrupts: [], dispels: [] },
      eventPages: groupRuleEventsByAbility(rawEvents, [selectedRule.spell_id]),
    });

    const applicableRules = new Map(ruleResult.results.filter((rule) => ruleApplies(rule, payload.difficulty!)).map((rule) => [rule.id, rule]));
    const storedEvents = await db.prepare("SELECT player_id, rule_id FROM events WHERE pull_id = ? AND player_id IS NOT NULL AND rule_id IS NOT NULL")
      .bind(pull.id).all<StoredEventRow>();
    const playerById = new Map(playerResult.results.map((player) => [player.player_id, player]));
    const otherPenalty = new Map<string, number>();
    const previousMatches = new Map<string, number>();
    for (const event of storedEvents.results) {
      const player = playerById.get(event.player_id);
      if (!player) continue;
      if (event.rule_id === selectedRule.id) {
        previousMatches.set(event.player_id, (previousMatches.get(event.player_id) ?? 0) + 1);
        continue;
      }
      const rule = applicableRules.get(event.rule_id);
      if (!rule || !player || !isPenaltyRule(rule)) continue;
      const roles = parseJson<string[]>(rule.roles_json, []);
      const condition = parseJson<RuleCondition>(rule.condition_json, {});
      if ((roles.length && !roles.includes(player.role)) || (condition.ignoreTanks && player.role === "Tank")) continue;
      otherPenalty.set(player.player_id, (otherPenalty.get(player.player_id) ?? 0) + Number(rule.weight));
    }

    const findingsByPlayer = new Map<string, typeof findings>();
    for (const finding of findings) {
      const current = findingsByPlayer.get(finding.playerId) ?? [];
      current.push(finding);
      findingsByPlayer.set(finding.playerId, current);
    }
    const penaltyRule = isPenaltyRule(selectedRule);
    const matchedPlayers = playerResult.results.filter((player) => (findingsByPlayer.get(player.player_id)?.length ?? 0) > 0);
    const playerResults = matchedPlayers.map((player) => {
      const playerFindings = findingsByPlayer.get(player.player_id) ?? [];
      const selectedPenalty = penaltyRule ? playerFindings.length * Number(selectedRule.weight) : 0;
      return {
        playerId: player.player_id,
        name: player.name,
        realm: player.realm,
        role: player.role,
        currentScore: Math.round(Number(player.mechanics_score)),
        projectedScore: clampScore(100 - (otherPenalty.get(player.player_id) ?? 0) - selectedPenalty),
        previousMatches: previousMatches.get(player.player_id) ?? 0,
        matches: playerFindings.length,
        deduction: selectedPenalty,
        events: playerFindings.slice(0, 8).map((finding) => ({
          seconds: Math.max(0, Math.round((finding.timestamp - fight.startTime) / 1000)),
          amount: finding.amount || null,
          detail: finding.detail,
        })),
      };
    }).sort((left, right) => right.matches - left.matches || left.name.localeCompare(right.name));

    const totalMatches = findings.length;
    const totalDeduction = playerResults.reduce((total, player) => total + player.deduction, 0);
    const maximumPlayerDeduction = Math.max(0, ...playerResults.map((player) => player.deduction));
    const warnings: string[] = [];
    if (totalMatches === 0) warnings.push("This rule matched nobody on the selected pull. Confirm the Spell ID and event type before applying it broadly.");
    if (maximumPlayerDeduction >= 25 || totalMatches > Math.max(10, playerResult.results.length * 5)) warnings.push("This rule has a high score impact. Double-check its points, role coverage, and maximum-match cap.");
    if (participantIds.size < playerResult.results.length) warnings.push(`${playerResult.results.length - participantIds.size} active player${playerResult.results.length - participantIds.size === 1 ? " was" : "s were"} not mapped to a Warcraft Logs actor on this pull.`);

    return Response.json({ audit: {
      bossName: pull.boss_name,
      difficulty: difficultyNames[pull.difficulty] ?? payload.difficulty,
      pull: { id: pull.id, label: `${pull.raid_night} · Pull ${pull.pull_number}`, raidNight: pull.raid_night, happenedAt: pull.happened_at, pullNumber: pull.pull_number, result: pull.killed ? "Kill" : "Wipe", duration: durationLabel(pull.start_time, pull.end_time), reportCode: pull.code },
      rule: { id: selectedRule.id, name: selectedRule.name, spellId: selectedRule.spell_id, category: selectedRule.category, severity: selectedRule.severity, weight: Number(selectedRule.weight), eventType: selectedRule.event_type, scoringMode: penaltyRule ? "penalty" : "success" },
      summary: { participantCount: playerResult.results.length, matchedPlayers: matchedPlayers.length, unmatchedPlayers: playerResult.results.length - matchedPlayers.length, totalMatches, totalDeduction, previousMatches: [...previousMatches.values()].reduce((sum, value) => sum + value, 0) },
      warnings,
      players: playerResults,
    } });
  } catch (error) {
    if (error instanceof WarcraftLogsRateLimitError) return Response.json({ error: error.message }, { status: 429 });
    return Response.json({ error: error instanceof Error ? error.message : "The scoring audit could not be completed." }, { status: 500 });
  }
}
