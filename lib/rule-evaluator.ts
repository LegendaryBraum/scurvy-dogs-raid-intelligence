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

export type RuleContextEvents = { deaths: unknown[]; interrupts: unknown[]; dispels: unknown[] };

export type EvaluatedRuleFinding = {
  rule: StoredRule;
  playerId: string;
  role: string;
  timestamp: number;
  amount: number;
  eventType: string;
  outcome: "success" | "warning";
  ability: string;
  icon?: string;
  detail: string;
  scoringMode: "penalty" | "success";
};

export type RuleEvaluationFight = {
  id: number;
  name: string;
  encounterID: number;
  startTime: number;
  endTime: number;
  difficulty?: number;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function record(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }

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

export function evaluateFightRules({
  fight,
  rules,
  participantIds,
  participantRoles,
  abilities,
  contextEvents,
  eventPages,
}: {
  fight: RuleEvaluationFight;
  rules: StoredRule[];
  participantIds: Map<number, string>;
  participantRoles: Map<string, string>;
  abilities: Map<number, { name: string; icon?: string | null }>;
  contextEvents: RuleContextEvents;
  eventPages: Map<number, unknown[]>;
}) {
  const difficulty = difficultyNames[fight.difficulty ?? 0] ?? "Unknown";
  const occurrences = new Map<string, number>();
  const countedOnce = new Set<string>();
  const findings: EvaluatedRuleFinding[] = [];

  for (const rule of rules) {
    const roles = parseJson<string[]>(rule.roles_json, []);
    const difficulties = parseJson<string[]>(rule.difficulties_json, []);
    const condition = parseJson<RuleCondition>(rule.condition_json, {});
    const configuredMode = condition.scoringMode ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
    if (configuredMode === "context") continue;

    for (const raw of candidateEvents(rule, eventPages, contextEvents)) {
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

      const scoringMode = configuredMode === "success" ? "success" : "penalty";
      const outcome = scoringMode === "success" ? "success" : "warning";
      const amountDetail = amount > 0 ? ` · ${compactAmount(amount)} damage` : "";
      const detail = scoringMode === "success"
        ? `${rule.category} completed${amountDetail}.`
        : `${rule.severity} ${rule.category.toLowerCase()} finding${amountDetail}.`;
      const abilityMetadata = abilities.get(rule.spell_id);
      findings.push({
        rule,
        playerId,
        role,
        timestamp,
        amount,
        eventType: String(event.type ?? rule.event_type),
        outcome,
        ability: abilityMetadata?.name ?? rule.name,
        icon: abilityMetadata?.icon ?? undefined,
        detail,
        scoringMode,
      });
    }
  }
  return findings;
}
