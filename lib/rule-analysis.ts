import { makeId } from "../db/runtime";
import type { WclReportOverview } from "./warcraft-logs";
import { fetchFightEventsBatch } from "./warcraft-logs";

export type StoredRule = {
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
  enabled: number;
  updated_at: string;
};

type RuleCondition = {
  minAmount?: number;
  countOncePerCast?: boolean;
  ignoreTanks?: boolean;
  scoringMode?: "penalty" | "success" | "context";
  maxOccurrencesPerPull?: number;
  note?: string;
};

type RuleContextEvents = { deaths: unknown[]; interrupts: unknown[]; dispels: unknown[] };

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function record(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

function ruleAppliesToDifficulty(rule: StoredRule, difficulty: string) {
  const difficulties = parseJson<string[]>(rule.difficulties_json, []);
  return difficulties.length === 0 || difficulties.includes(difficulty);
}

function eventSpellId(value: unknown) {
  const event = record(value);
  return number(event.abilityGameID ?? event.abilityID ?? record(event.ability).gameID ?? record(event.ability).id);
}

function eventExtraSpellId(value: unknown) {
  const event = record(value);
  return number(event.extraAbilityGameID ?? event.extraAbilityID ?? record(event.extraAbility).gameID ?? record(event.extraAbility).id);
}

function eventActorId(value: unknown, preferSource = false) {
  const event = record(value);
  return number(preferSource ? (event.sourceID ?? event.targetID) : (event.targetID ?? event.sourceID));
}

function eventTimestamp(value: unknown, fallback: number) {
  return number(record(value).timestamp) || fallback;
}

function eventMatchesType(value: unknown, eventType: string) {
  const type = String(record(value).type ?? "").toLowerCase();
  if (eventType === "damage") return type === "damage" || type === "absorbed";
  if (eventType === "debuff") return type === "applydebuff" || type === "applydebuffstack" || type === "refreshdebuff";
  if (eventType === "cast") return type === "cast" || type === "begincast";
  if (eventType === "death") return type === "death";
  if (eventType === "interrupt") return type === "interrupt";
  if (eventType === "dispel") return type === "dispel";
  return false;
}

function compactAmount(amount: number) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}k`;
  return String(Math.round(amount));
}

function candidateEvents(rule: StoredRule, eventPages: Map<number, unknown[]>, contextEvents: RuleContextEvents) {
  const direct = eventPages.get(rule.spell_id) ?? [];
  if (direct.length) return direct.filter((event) => eventMatchesType(event, rule.event_type));
  if (rule.event_type === "dispel") {
    return contextEvents.dispels.filter((event) => eventExtraSpellId(event) === rule.spell_id || eventSpellId(event) === rule.spell_id);
  }
  if (rule.event_type === "interrupt") {
    return contextEvents.interrupts.filter((event) => eventExtraSpellId(event) === rule.spell_id || eventSpellId(event) === rule.spell_id);
  }
  if (rule.event_type === "death") {
    return contextEvents.deaths.filter((event) => eventSpellId(event) === rule.spell_id);
  }
  return direct.filter((event) => eventMatchesType(event, rule.event_type));
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
  const occurrences = new Map<string, number>();
  const countedOnce = new Set<string>();
  let eventRows = 0;

  for (const rule of rules) {
    const roles = parseJson<string[]>(rule.roles_json, []);
    const difficulties = parseJson<string[]>(rule.difficulties_json, []);
    const condition = parseJson<RuleCondition>(rule.condition_json, {});
    const scoringMode = condition.scoringMode ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
    if (scoringMode === "context") continue;

    for (const raw of candidateEvents(rule, resolvedEventPages, contextEvents)) {
      const preferSource = ["cast", "interrupt", "dispel"].includes(rule.event_type);
      const playerId = participantIds.get(eventActorId(raw, preferSource));
      if (!playerId) continue;
      const role = participantRoles.get(playerId) ?? "DPS";
      const event = record(raw);
      const amount = number(event.amount);
      if ((roles.length && !roles.includes(role)) || (difficulties.length && !difficulties.includes(difficulty))) continue;
      if (condition.ignoreTanks && role === "Tank") continue;
      if (condition.minAmount && amount < condition.minAmount) continue;

      const timestamp = eventTimestamp(raw, fight.startTime);
      const onceKey = `${rule.id}:${playerId}:${Math.floor(timestamp / 1000)}`;
      if (condition.countOncePerCast && countedOnce.has(onceKey)) continue;
      countedOnce.add(onceKey);

      const occurrenceKey = `${rule.id}:${playerId}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      if (condition.maxOccurrencesPerPull && occurrence > condition.maxOccurrencesPerPull) continue;
      occurrences.set(occurrenceKey, occurrence);

      const outcome = scoringMode === "success" ? "success" : "warning";
      const amountDetail = amount > 0 ? ` · ${compactAmount(amount)} damage` : "";
      const detail = scoringMode === "success"
        ? `${rule.category} completed${amountDetail}.`
        : `${rule.severity} ${rule.category.toLowerCase()} finding${amountDetail}.`;
      const abilityMetadata = abilities.get(rule.spell_id);
      const ability = abilityMetadata?.name ?? rule.name;
      await db.prepare("INSERT INTO events (id, pull_id, player_id, rule_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(makeId("event"), pullId, playerId, rule.id, rule.spell_id, String(event.type ?? rule.event_type), timestamp, amount || null, outcome, JSON.stringify({ ability, icon: abilityMetadata?.icon ?? undefined, detail, severity: rule.severity, source: "Warcraft Logs" })).run();
      eventRows += 1;
    }
  }

  const scoreResult = await recomputePullMechanicsScores(db, pullId, bossId, difficulty);
  await markPullRuleAnalysis(db, pullId, stateRules ?? rules);
  return { eventRows, playersPenalized: scoreResult.playersPenalized };
}
