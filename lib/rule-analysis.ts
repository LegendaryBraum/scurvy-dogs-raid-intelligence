import { makeId } from "../db/runtime";
import type { WclReportOverview } from "./warcraft-logs";
import { fetchFightEventsBatch } from "./warcraft-logs";

export type StoredRule = {
  id: string;
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

export async function analyzeFightRules({
  db,
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
}: {
  db: D1Database;
  reportCode: string;
  fight: WclReportOverview["fights"][number];
  pullId: string;
  token: string;
  rules: StoredRule[];
  participantIds: Map<number, string>;
  participantRoles: Map<string, string>;
  abilities: Map<number, string>;
  contextEvents: RuleContextEvents;
  eventPages?: Map<number, unknown[]>;
  resetExisting?: boolean;
}) {
  if (resetExisting) {
    await db.batch([
      db.prepare("DELETE FROM events WHERE pull_id = ? AND rule_id IS NOT NULL").bind(pullId),
      db.prepare("UPDATE pull_players SET mechanics_score = 100 WHERE pull_id = ?").bind(pullId),
    ]);
  }

  const fetchedSpellIds = rules
    .filter((rule) => parseJson<RuleCondition>(rule.condition_json, {}).scoringMode !== "context")
    .filter((rule) => !["dispel", "interrupt", "death"].includes(rule.event_type))
    .map((rule) => rule.spell_id);
  const resolvedEventPages = eventPages ?? await fetchFightEventsBatch(reportCode, fight.id, fetchedSpellIds, token);
  const difficulty = difficultyNames[fight.difficulty ?? 0] ?? "Unknown";
  const penalties = new Map<string, number>();
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
      const ability = abilities.get(rule.spell_id) ?? rule.name;
      await db.prepare("INSERT INTO events (id, pull_id, player_id, rule_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(makeId("event"), pullId, playerId, rule.id, rule.spell_id, String(event.type ?? rule.event_type), timestamp, amount || null, outcome, JSON.stringify({ ability, detail, severity: rule.severity, source: "Warcraft Logs" })).run();
      if (scoringMode === "penalty") penalties.set(playerId, (penalties.get(playerId) ?? 0) + rule.weight);
      eventRows += 1;
    }
  }

  for (const [playerId, penalty] of penalties) {
    await db.prepare("UPDATE pull_players SET mechanics_score = ? WHERE pull_id = ? AND player_id = ?")
      .bind(clampScore(100 - penalty), pullId, playerId).run();
  }
  return { eventRows, playersPenalized: penalties.size };
}
