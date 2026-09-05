import type { MechanicRule } from "./types";

export type CalibrationBand = "Major issue" | "Minor issue" | "Positive play" | "Raid context";
export type CalibrationConfidence = "High confidence" | "Review suggested";

export type CalibrationCandidate = {
  id: string;
  insightName: string;
  name: string;
  description: string;
  spellId: number | null;
  icon?: string;
  category: MechanicRule["category"];
  severity: MechanicRule["severity"];
  weight: number;
  eventType: MechanicRule["eventType"] | null;
  scoringMode: NonNullable<MechanicRule["condition"]["scoringMode"]>;
  roles: string[];
  maxOccurrencesPerPull?: number;
  band: CalibrationBand;
  confidence: CalibrationConfidence;
  confidenceReason: string;
  wipefestPercentile: number | null;
  alreadyConfigured: boolean;
  selected: boolean;
};

export type CalibrationPreview = {
  bossId: string;
  reportCode: string;
  fightId: number;
  reportTitle: string;
  bossName: string;
  encounterId: number;
  difficulty: string;
  wipefestPercentile: number | null;
  sourceUrl: string;
  candidates: CalibrationCandidate[];
  counts: Record<CalibrationBand, number>;
};

type JsonRecord = Record<string, unknown>;

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };
const supportedEventTypes = new Set<MechanicRule["eventType"]>(["damage", "debuff", "cast", "interrupt", "dispel", "death"]);
const skippedInsightNames = /ready check|flask|food|potion|healthstone|item level|enchants?|gems?|tier pieces/i;

type WipefestReportFight = { id?: number; difficulty?: number };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDifficulties(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function configuredForDifficulty(existingRules: Array<{ spell_id: number; event_type: string; difficulties_json?: string | null }>, spellId: number, eventType: string, difficulty: string) {
  return existingRules.some((rule) => {
    if (rule.spell_id !== spellId || rule.event_type !== eventType) return false;
    const difficulties = parseDifficulties(rule.difficulties_json);
    return difficulties.length === 0 || difficulties.includes(difficulty);
  });
}

function decodeEntities(value: string) {
  return value
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function plainWipefestText(value: unknown) {
  if (typeof value !== "string") return "";
  return decodeEntities(value)
    .replace(/\{\[image="[^"]*" url="[^"]*" style="[^"]*"\]\s*([^}]*)\}/g, "$1")
    .replace(/\{\[style="[^"]*"\]\s*([^}]*)\}/g, "$1")
    .replace(/\{ability:[^:}]+:([^:}]+)[^}]*\}/g, "$1")
    .replace(/\{npc:([^}]*)\}/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableName(value: unknown) {
  return plainWipefestText(value)
    .toLowerCase()
    .replace(/^(average duration of|damage from|hits? from|interrupts? of|dispels? of|deaths? from|amount of)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractAbilityIds(filter: JsonRecord) {
  const ability = record(filter.ability);
  const ids = Array.isArray(ability.ids) ? ability.ids : ability.id !== undefined ? [ability.id] : [];
  return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function abilitiesFromValue(value: unknown, output = new Map<number, { name: string; icon?: string }>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => abilitiesFromValue(item, output));
    return output;
  }
  const item = record(value);
  if (!Object.keys(item).length) return output;
  const guid = numberOrNull(item.guid);
  const name = typeof item.name === "string" ? item.name : "";
  const looksLikeAbility = typeof item.abilityIcon === "string" || typeof item.iconUrl === "string" || (typeof item.url === "string" && /spell=\d+/i.test(item.url));
  if (guid && name && looksLikeAbility) output.set(guid, { name, icon: typeof item.abilityIcon === "string" ? item.abilityIcon : typeof item.iconUrl === "string" ? item.iconUrl : undefined });
  Object.values(item).forEach((child) => abilitiesFromValue(child, output));
  return output;
}

function titleAbilityIds(title: unknown) {
  if (typeof title !== "string") return [];
  return [...title.matchAll(/wowhead\.com\/spell=(\d+)/g)].map((match) => Number(match[1]));
}

function rolesFor(text: string) {
  if (/non[- ]?tanks?/i.test(text)) return ["Healer", "DPS"];
  if (/\btanks?\b|tank swap|tank buster/i.test(text)) return ["Tank"];
  return ["Tank", "Healer", "DPS"];
}

function modeFor(config: JsonRecord, eventType: MechanicRule["eventType"] | null, description: string) {
  if (!eventType) return "context" as const;
  const playerValue = record(config.playerValue);
  if (eventType === "interrupt" || eventType === "dispel") return "success" as const;
  if (Number(playerValue.weight) < 0 || /died|failed|avoidable|stood|hit by|splashed|too close|unnecessarily|lethal|knocked|erupted/i.test(description)) return "penalty" as const;
  return "context" as const;
}

function severityFor(description: string, major: boolean, mode: CalibrationCandidate["scoringMode"]) {
  if (mode !== "penalty") return "Low" as const;
  if (/died|lethal|entire raid|raid wipe|cease to exist/i.test(description)) return "Critical" as const;
  if (major || /failed|heavy raid-wide|erupted .*raid|causing the entire raid/i.test(description)) return "High" as const;
  if (/avoidable|stood|splashed|too close|unnecessarily|heavy damage|knocked|hit|damage/i.test(description)) return "Medium" as const;
  return "Low" as const;
}

function categoryFor(eventType: MechanicRule["eventType"] | null, description: string, mode: CalibrationCandidate["scoringMode"]): MechanicRule["category"] {
  if (eventType === "interrupt") return "Interrupt";
  if (eventType === "dispel") return "Dispel";
  if (/soak/i.test(description)) return "Soak";
  if (/defensive|healthstone|healing potion/i.test(description)) return "Defensive";
  if (mode === "success") return "Utility";
  if (eventType === "damage" && /avoidable|stood|impact zone|too close|unnecessarily/i.test(description)) return "Avoidable damage";
  return "Mechanic failure";
}

function defaultsFor(severity: MechanicRule["severity"], mode: CalibrationCandidate["scoringMode"]) {
  if (mode !== "penalty") return { weight: 0, maxOccurrencesPerPull: undefined };
  if (severity === "Critical") return { weight: 20, maxOccurrencesPerPull: 1 };
  if (severity === "High") return { weight: 8, maxOccurrencesPerPull: 3 };
  if (severity === "Medium") return { weight: 4, maxOccurrencesPerPull: 4 };
  return { weight: 2, maxOccurrencesPerPull: 5 };
}

function bandFor(severity: MechanicRule["severity"], mode: CalibrationCandidate["scoringMode"]): CalibrationBand {
  if (mode === "success") return "Positive play";
  if (mode === "context") return "Raid context";
  return severity === "Critical" || severity === "High" ? "Major issue" : "Minor issue";
}

function percentileFor(insight: JsonRecord, mainStatistic: unknown) {
  const statistics = Array.isArray(insight.statistics) ? insight.statistics.map(record) : [];
  const preferred = statistics.find((statistic) => statistic.name === mainStatistic) ?? statistics[0];
  const percentile = numberOrNull(preferred?.percentile);
  return percentile === null ? null : Math.max(0, Math.min(100, Math.round(percentile)));
}

function eventTypeFor(value: unknown): MechanicRule["eventType"] | null {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "ability") return "cast";
  return supportedEventTypes.has(normalized as MechanicRule["eventType"]) ? normalized as MechanicRule["eventType"] : null;
}

function preferredWipefestEventTypes(configType: unknown) {
  const normalized = String(configType ?? "").toLowerCase();
  if (normalized === "hit" || normalized === "damage") return ["damage"];
  if (normalized === "interrupt") return ["interrupt"];
  if (normalized === "dispel") return ["dispel"];
  if (normalized === "removedebuff") return ["dispel"];
  if (normalized === "debuff" || normalized === "applydebuff") return ["debuff"];
  if (normalized === "cast" || normalized === "ability") return ["cast", "ability"];
  if (normalized === "death") return ["death"];
  return [];
}

function uniqueCandidates(candidates: CalibrationCandidate[]) {
  const exact = new Map<string, CalibrationCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.spellId ?? candidate.id}:${candidate.eventType ?? "context"}:${candidate.scoringMode}`;
    const current = exact.get(key);
    if (!current || (current.confidence === "Review suggested" && candidate.confidence === "High confidence")) exact.set(key, candidate);
  }
  const byMechanic = new Map<string, CalibrationCandidate>();
  const eventPreference: Record<string, number> = { death: 5, damage: 4, interrupt: 4, dispel: 4, debuff: 2, cast: 1, context: 0 };
  for (const candidate of exact.values()) {
    const nameKey = candidate.name.toLowerCase().replace(/^death to\s+/, "death:").replace(/[^a-z0-9:]+/g, "-");
    const key = `${nameKey}:${candidate.scoringMode}`;
    const current = byMechanic.get(key);
    const candidateRank = eventPreference[candidate.eventType ?? "context"] ?? 0;
    const currentRank = current ? eventPreference[current.eventType ?? "context"] ?? 0 : -1;
    if (!current || candidateRank > currentRank) byMechanic.set(key, candidate);
  }
  return [...byMechanic.values()];
}

export function parseWipefestUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Paste a full Wipefest fight link."); }
  if (!/^(?:www\.)?wipefest\.gg$/i.test(url.hostname)) throw new Error("Use a wipefest.gg report link.");
  const match = url.pathname.match(/^\/report\/([A-Za-z0-9]+)\/fight\/(\d+|last)\/?$/i);
  if (!match) throw new Error("Paste a Wipefest boss pull link ending in /fight/number or /fight/last.");
  const fightSelector = match[2].toLowerCase();
  return {
    reportCode: match[1],
    fightId: fightSelector === "last" ? "last" as const : Number(fightSelector),
    sourceUrl: url.toString(),
  };
}

export async function resolveWipefestFightId(reportCode: string, fightId: number | "last", request: typeof fetch = fetch) {
  if (fightId !== "last") return fightId;
  const reportResponse = await request(`https://api.wipefest.gg/report/${encodeURIComponent(reportCode)}?gameVersion=warcraft-live`, {
    headers: { Accept: "application/json" },
  });
  if (!reportResponse.ok) throw new Error(`Wipefest could not resolve the latest pull (${reportResponse.status}).`);
  const report = await reportResponse.json() as { fights?: WipefestReportFight[] };
  const latestFightId = (report.fights ?? [])
    .filter((fight) => Number.isInteger(Number(fight.id)) && Number.isInteger(Number(fight.difficulty)))
    .reduce((latest, fight) => Math.max(latest, Number(fight.id)), 0);
  if (!latestFightId) throw new Error("Wipefest could not find a supported pull at the end of that report.");
  return latestFightId;
}

export function buildCalibrationPreview({ payload, sourceUrl, bossId, existingRules }: { payload: unknown; sourceUrl: string; bossId: string; existingRules: Array<{ spell_id: number; event_type: string; difficulties_json?: string | null }> }): CalibrationPreview {
  const response = record(payload);
  const info = record(response.info);
  const report = record(response.report);
  const encounterId = Number(info.boss);
  const difficulty = difficultyNames[Number(info.difficulty)] ?? "Unknown";
  const insightConfigs = Array.isArray(response.insightConfigs) ? response.insightConfigs.map(record) : [];
  const eventConfigs = Array.isArray(response.eventConfigs) ? response.eventConfigs.map(record) : [];
  const insights = Array.isArray(response.insights) ? response.insights.map(record) : [];
  const insightsByKey = new Map(insights.map((insight) => [`${String(insight.group)}:${String(insight.id)}`, insight]));
  const reportAbilities = new Map((Array.isArray(response.abilities) ? response.abilities : []).map((value) => {
    const ability = record(value);
    return [Number(ability.guid), { name: String(ability.name ?? "Unknown mechanic"), icon: typeof ability.abilityIcon === "string" ? ability.abilityIcon : typeof ability.iconUrl === "string" ? ability.iconUrl : undefined }] as const;
  }).filter(([id]) => Number.isInteger(id) && id > 0));

  const candidates: CalibrationCandidate[] = [];
  for (const config of insightConfigs) {
    if (String(config.group) !== String(encounterId) || skippedInsightNames.test(String(config.name ?? ""))) continue;
    const insight = insightsByKey.get(`${String(config.group)}:${String(config.id)}`) ?? {};
    const observedTitle = plainWipefestText(insight.title);
    if (!observedTitle || insight.show === false) continue;
    const templateTitle = plainWipefestText(config.title);
    const description = observedTitle || templateTitle || String(config.name ?? "Encounter mechanic");
    const configName = comparableName(config.name);
    const insightAbilities = abilitiesFromValue(insight.values);
    for (const abilityId of titleAbilityIds(insight.title)) if (!insightAbilities.has(abilityId) && reportAbilities.has(abilityId)) insightAbilities.set(abilityId, reportAbilities.get(abilityId)!);

    const eventMatches = eventConfigs.filter((eventConfig) => {
      if (String(eventConfig.group) !== String(encounterId)) return false;
      const tags = strings(eventConfig.tags).map((tag) => tag.toLowerCase());
      if (!tags.includes("player")) return false;
      const eventName = comparableName(eventConfig.name);
      const eventIds = extractAbilityIds(record(eventConfig.filter));
      const nameMatches = Boolean(configName && eventName && (configName.includes(eventName) || eventName.includes(configName)));
      const abilityMatches = eventIds.some((id) => insightAbilities.has(id));
      return nameMatches || abilityMatches;
    });
    const preferredTypes = preferredWipefestEventTypes(config.type);
    const matchingEvents = preferredTypes.length ? eventMatches.filter((eventConfig) => preferredTypes.includes(String(eventConfig.eventType ?? "").toLowerCase())) : eventMatches;

    if (!matchingEvents.length) {
      const firstAbility = [...insightAbilities.entries()][0];
      const severity = severityFor(description, insight.major === true, "context");
      candidates.push({
        id: `context-${String(config.group)}-${String(config.id)}`,
        insightName: String(config.name ?? "Raid context"),
        name: firstAbility?.[1].name ?? String(config.name ?? "Raid context"),
        description,
        spellId: firstAbility?.[0] ?? null,
        icon: firstAbility?.[1].icon,
        category: categoryFor(null, description, "context"),
        severity,
        weight: 0,
        eventType: null,
        scoringMode: "context",
        roles: rolesFor(`${String(config.name ?? "")} ${description}`),
        band: "Raid context",
        confidence: "Review suggested",
        confidenceReason: "Wipefest describes this mechanic, but does not expose one fair player event to score.",
        wipefestPercentile: percentileFor(insight, config.mainStatistic),
        alreadyConfigured: false,
        selected: false,
      });
      continue;
    }

    for (const eventConfig of matchingEvents) {
      const eventType = eventTypeFor(eventConfig.eventType);
      const ids = extractAbilityIds(record(eventConfig.filter));
      if (!eventType || !ids.length) continue;
      for (const spellId of ids) {
        const ability = insightAbilities.get(spellId) ?? reportAbilities.get(spellId) ?? { name: String(eventConfig.name ?? config.name ?? "Encounter mechanic") };
        const mode = modeFor(config, eventType, description);
        const severity = severityFor(description, insight.major === true, mode);
        const defaults = defaultsFor(severity, mode);
        const alreadyConfigured = configuredForDifficulty(existingRules, spellId, eventType, difficulty);
        const highConfidence = ids.length === 1 && strings(eventConfig.tags).map((tag) => tag.toLowerCase()).includes("player");
        candidates.push({
          id: `${String(config.group)}-${String(config.id)}-${String(eventConfig.id)}-${spellId}`,
          insightName: String(config.name ?? ability.name),
          name: ability.name,
          description,
          spellId,
          icon: ability.icon,
          category: categoryFor(eventType, description, mode),
          severity,
          weight: defaults.weight,
          eventType,
          scoringMode: mode,
          roles: rolesFor(`${String(config.name ?? "")} ${description}`),
          maxOccurrencesPerPull: defaults.maxOccurrencesPerPull,
          band: bandFor(severity, mode),
          confidence: highConfidence ? "High confidence" : "Review suggested",
          confidenceReason: highConfidence ? "Wipefest exposes one player event and one exact Spell ID." : "Wipefest exposes multiple possible player events; verify this mapping before saving.",
          wipefestPercentile: percentileFor(insight, config.mainStatistic),
          alreadyConfigured,
          selected: !alreadyConfigured && mode !== "context",
        });
      }
    }
  }

  const deathConfig = insightConfigs.find((config) => String(config.group) === "raid" && /deaths?/i.test(String(config.name ?? "")));
  const deathInsight = deathConfig ? insightsByKey.get(`raid:${String(deathConfig.id)}`) : undefined;
  const deathDescription = plainWipefestText(deathInsight?.title);
  if (deathConfig && deathInsight && deathDescription && deathInsight.show !== false) {
    const deathAbilities = abilitiesFromValue(deathInsight.values);
    for (const abilityId of titleAbilityIds(deathInsight.title)) if (!deathAbilities.has(abilityId) && reportAbilities.has(abilityId)) deathAbilities.set(abilityId, reportAbilities.get(abilityId)!);
    for (const [spellId, ability] of deathAbilities) {
      const alreadyConfigured = configuredForDifficulty(existingRules, spellId, "death", difficulty);
      candidates.push({
        id: `raid-death-${spellId}`,
        insightName: "Deaths",
        name: `Death to ${ability.name}`,
        description: deathDescription,
        spellId,
        icon: ability.icon,
        category: "Mechanic failure",
        severity: "Critical",
        weight: 20,
        eventType: "death",
        scoringMode: "penalty",
        roles: ["Tank", "Healer", "DPS"],
        maxOccurrencesPerPull: 1,
        band: "Major issue",
        confidence: "High confidence",
        confidenceReason: "Wipefest identified the killing ability, so Warcraft Logs can assign the death to the affected player.",
        wipefestPercentile: percentileFor(deathInsight, deathConfig.mainStatistic),
        alreadyConfigured,
        selected: !alreadyConfigured,
      });
    }
  }

  const cleaned = uniqueCandidates(candidates).sort((a, b) => {
    const bandOrder: Record<CalibrationBand, number> = { "Major issue": 0, "Minor issue": 1, "Positive play": 2, "Raid context": 3 };
    return bandOrder[a.band] - bandOrder[b.band] || a.name.localeCompare(b.name);
  });
  const counts: Record<CalibrationBand, number> = { "Major issue": 0, "Minor issue": 0, "Positive play": 0, "Raid context": 0 };
  cleaned.forEach((candidate) => { counts[candidate.band] += 1; });
  const parsedUrl = parseWipefestUrl(sourceUrl);
  const payloadFightId = Number(info.id);
  return {
    bossId,
    reportCode: String(report.id ?? parsedUrl.reportCode),
    fightId: Number.isInteger(payloadFightId) && payloadFightId > 0
      ? payloadFightId
      : typeof parsedUrl.fightId === "number" ? parsedUrl.fightId : 0,
    reportTitle: String(report.title ?? "Wipefest report"),
    bossName: String(info.name ?? "Unknown boss"),
    encounterId,
    difficulty,
    wipefestPercentile: numberOrNull(response.percentile),
    sourceUrl,
    candidates: cleaned,
    counts,
  };
}
