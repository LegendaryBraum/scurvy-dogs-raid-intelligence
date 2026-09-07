import { makeId } from "../db/runtime";
import type { WclReportOverview } from "./warcraft-logs";
import { fetchFightEventsBatch } from "./warcraft-logs";
import { evaluateFightRules, type RuleContextEvents, type StoredRule } from "./rule-evaluator";

export { evaluateFightRules } from "./rule-evaluator";
export type { EvaluatedRuleFinding, RuleContextEvents, StoredRule } from "./rule-evaluator";

type RuleCondition = {
  minAmount?: number;
  countOncePerCast?: boolean;
  ignoreTanks?: boolean;
  scoringMode?: "penalty" | "success" | "context";
  maxOccurrencesPerPull?: number;
  note?: string;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

function ruleAppliesToDifficulty(rule: StoredRule, difficulty: string) {
  const difficulties = parseJson<string[]>(rule.difficulties_json, []);
  return difficulties.length === 0 || difficulties.includes(difficulty);
}

export async function clearPullRuleEvents(db: D1Database, pullId: string, ruleIds: string[]) {
  const ids = [...new Set(ruleIds.filter(Boolean))];
  if (!ids.length) return;
  await db.prepare(`DELETE FROM events WHERE pull_id = ? AND rule_id IN (${ids.map(() => "?").join(", ")})`).bind(pullId, ...ids).run();
}

export async function markPullRuleAnalysis(db: D1Database, pullId: string, rules: StoredRule[]) {
  if (!rules.length) return;
  await db.batch(rules.map((rule) => db.prepare("INSERT INTO rule_analysis_state (pull_id, rule_id, rule_updated_at, analyzed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(pull_id, rule_id) DO UPDATE SET rule_updated_at = excluded.rule_updated_at, analyzed_at = CURRENT_TIMESTAMP")
    .bind(pullId, rule.id, rule.updated_at)));
}

export async function recomputePullMechanicsScores(db: D1Database, pullId: string, bossId: string, difficulty: string) {
  const [ruleResult, playerResult, eventResult] = await Promise.all([
    db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(bossId).all<StoredRule>(),
    db.prepare("SELECT pp.player_id, p.role FROM pull_players pp JOIN players p ON p.id = pp.player_id WHERE pp.pull_id = ?").bind(pullId).all<{ player_id: string; role: string }>(),
    db.prepare("SELECT player_id, rule_id FROM events WHERE pull_id = ? AND rule_id IS NOT NULL AND player_id IS NOT NULL").bind(pullId).all<{ player_id: string; rule_id: string }>(),
  ]);
  const players = new Map(playerResult.results.map((player) => [player.player_id, player]));
  const rules = new Map(ruleResult.results.filter((rule) => ruleAppliesToDifficulty(rule, difficulty)).map((rule) => [rule.id, rule]));
  const penalties = new Map<string, number>();
  for (const event of eventResult.results) {
    const player = players.get(event.player_id);
    const rule = rules.get(event.rule_id);
    if (!player || !rule) continue;
    const roles = parseJson<string[]>(rule.roles_json, []);
    const condition = parseJson<RuleCondition>(rule.condition_json, {});
    const scoringMode = condition.scoringMode ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
    if (scoringMode !== "penalty" || (roles.length && !roles.includes(player.role)) || (condition.ignoreTanks && player.role === "Tank")) continue;
    penalties.set(player.player_id, (penalties.get(player.player_id) ?? 0) + rule.weight);
  }
  if (playerResult.results.length) {
    await db.batch(playerResult.results.map((player) => db.prepare("UPDATE pull_players SET mechanics_score = ? WHERE pull_id = ? AND player_id = ?")
      .bind(clampScore(100 - (penalties.get(player.player_id) ?? 0)), pullId, player.player_id)));
  }
  return { playersPenalized: penalties.size };
}

export async function analyzeFightRules({
  db,
  bossId,
  reportCode,
  fight,
  pullId,
  token,
  rules,
  participantIds,
  participantRoles,
  abilities,
  contextEvents,
  eventPages,
  resetExisting = false,
  replaceRuleIds = [],
  stateRules,
}: {
  db: D1Database;
  bossId: string;
  reportCode: string;
  fight: WclReportOverview["fights"][number];
  pullId: string;
  token: string;
  rules: StoredRule[];
  participantIds: Map<number, string>;
  participantRoles: Map<string, string>;
  abilities: Map<number, { name: string; icon?: string | null }>;
  contextEvents: RuleContextEvents;
  eventPages?: Map<number, unknown[]>;
  resetExisting?: boolean;
  replaceRuleIds?: string[];
  stateRules?: StoredRule[];
}) {
  if (resetExisting) {
    await db.batch([
      db.prepare("DELETE FROM events WHERE pull_id = ? AND rule_id IS NOT NULL").bind(pullId),
      db.prepare("UPDATE pull_players SET mechanics_score = 100 WHERE pull_id = ?").bind(pullId),
    ]);
  } else if (replaceRuleIds.length) {
    await clearPullRuleEvents(db, pullId, replaceRuleIds);
  }

  const fetchedSpellIds = rules
    .filter((rule) => parseJson<RuleCondition>(rule.condition_json, {}).scoringMode !== "context")
    .filter((rule) => !["dispel", "interrupt", "death"].includes(rule.event_type))
    .map((rule) => rule.spell_id);
  const resolvedEventPages = eventPages ?? await fetchFightEventsBatch(reportCode, fight.id, fetchedSpellIds, token);
  const difficulty = difficultyNames[fight.difficulty ?? 0] ?? "Unknown";
  const findings = evaluateFightRules({ fight, rules, participantIds, participantRoles, abilities, contextEvents, eventPages: resolvedEventPages });
  for (const finding of findings) {
    await db.prepare("INSERT INTO events (id, pull_id, player_id, rule_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(makeId("event"), pullId, finding.playerId, finding.rule.id, finding.rule.spell_id, finding.eventType, finding.timestamp, finding.amount || null, finding.outcome, JSON.stringify({ ability: finding.ability, icon: finding.icon, detail: finding.detail, severity: finding.rule.severity, source: "Warcraft Logs" })).run();
  }

  const scoreResult = await recomputePullMechanicsScores(db, pullId, bossId, difficulty);
  await markPullRuleAnalysis(db, pullId, stateRules ?? rules);
  return { eventRows: findings.length, playersPenalized: scoreResult.playersPenalized };
}
