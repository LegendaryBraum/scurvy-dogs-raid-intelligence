import type { MechanicRule, RaidEvent, ScoreKey } from "./types";

export type ScoreBreakdown = Record<ScoreKey, number>;

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function scoreMechanics(events: RaidEvent[], rules: MechanicRule[], role: string, difficulty: string) {
  let score = 100;
  const matched: { event: RaidEvent; rule: MechanicRule; penalty: number }[] = [];

  for (const event of events) {
    const rule = rules.find((candidate) =>
      candidate.spellId === event.spellId &&
      candidate.roles.includes(role) &&
      candidate.difficulties.includes(difficulty) &&
      !(candidate.condition.ignoreTanks && role === "Tank") &&
      (!candidate.condition.minAmount || (event.amount ?? 0) >= candidate.condition.minAmount)
    );
    if (!rule || event.kind === "success" || event.kind === "utility") continue;
    const deathMultiplier = event.kind === "death" ? 1.5 : 1;
    const penalty = rule.weight * deathMultiplier;
    score -= penalty;
    matched.push({ event, rule, penalty });
  }
  return { score: clamp(score), matched };
}

export function scorePerformance(parse: number, itemLevelParse: number) {
  return clamp(parse * 0.65 + itemLevelParse * 0.35);
}

export function scoreAttendance(attended: number, expected: number) {
  return expected <= 0 ? 100 : clamp((attended / expected) * 100);
}

export function scorePreparation(checks: { flask: boolean; food: boolean; enchanted: boolean; potionsUsed: number; expectedPotions: number }) {
  const binary = [checks.flask, checks.food, checks.enchanted].filter(Boolean).length / 3;
  const potions = Math.min(1, checks.potionsUsed / Math.max(1, checks.expectedPotions));
  return clamp(binary * 75 + potions * 25);
}
