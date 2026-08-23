export type WarcraftLogsCredentials = { clientId: string; clientSecret: string };

export type WclReportOverview = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  visibility: string;
  zone?: { name: string } | null;
  fights: Array<{
    id: number;
    name: string;
    encounterID: number;
    startTime: number;
    endTime: number;
    difficulty?: number | null;
    kill?: boolean | null;
    bossPercentage?: number | null;
    averageItemLevel?: number | null;
    friendlyPlayers?: number[] | null;
    friendlySpecs?: string[] | null;
    gameZone?: { id: number; name?: string | null } | null;
    keystoneAffixes?: number[] | null;
    rating?: number | null;
  }>;
  masterData?: {
    actors?: Array<{ id: number; name: string; type: string; subType: string; server?: string | null }> | null;
    abilities?: Array<{ gameID: number; name: string; icon?: string | null }> | null;
  } | null;
  rankings?: unknown;
};

export type WclImportPreview = {
  code: string;
  title: string;
  raid: string;
  visibility: string;
  startedAt: number;
  pullCount: number;
  playerCount: number;
  bosses: Array<{ name: string; pulls: number; kills: number }>;
  groups: Array<{
    id: string;
    label: string;
    description: string;
    kind: "raid" | "mythic_plus" | "other";
    defaultSelected: boolean;
    fights: Array<{
      id: number;
      name: string;
      pullNumber: number;
      difficulty: string;
      duration: string;
      result: string;
      playerCount: number;
    }>;
  }>;
};

export type WclRankingRow = {
  fightId: number;
  name: string;
  role?: string;
  spec?: string;
  parse: number | null;
  ilvlParse: number | null;
  amount: number | null;
};

const REPORT_PATTERN = /(?:warcraftlogs\.com\/reports\/|^)([A-Za-z0-9]{8,24})(?:[/?#]|$)/i;
const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function fightDuration(startTime: number, endTime: number) {
  const totalSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function classifyFight(fight: WclReportOverview["fights"][number]) {
  if ((fight.keystoneAffixes?.length ?? 0) > 0 || (fight.rating ?? 0) > 0) return "mythic_plus" as const;
  if (fight.difficulty && difficultyNames[fight.difficulty]) return "raid" as const;
  return "other" as const;
}

export function parseReportUrls(input: string | string[]) {
  const candidates = Array.isArray(input) ? input : input.split(/[\n,\s]+/);
  const seen = new Set<string>();
  const reports: { code: string; url: string }[] = [];
  const invalid: string[] = [];

  for (const raw of candidates.map((item) => item.trim()).filter(Boolean)) {
    const clean = raw.replace(/[),.;]+$/, "");
    const match = clean.match(REPORT_PATTERN);
    if (!match) {
      invalid.push(raw);
      continue;
    }
    const code = match[1];
    if (seen.has(code)) continue;
    seen.add(code);
    reports.push({ code, url: `https://www.warcraftlogs.com/reports/${code}` });
  }
  return { reports, invalid };
}

async function getAccessToken(credentials: WarcraftLogsCredentials) {
  const auth = btoa(`${credentials.clientId}:${credentials.clientSecret}`);
  const response = await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`Warcraft Logs authentication failed (${response.status}).`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Warcraft Logs did not return an access token.");
  return payload.access_token;
}

async function graphQL<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://www.warcraftlogs.com/api/v2/client", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 650 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const payload = await response.json() as { data?: T; errors?: { message: string }[] };
    if (!response.ok || payload.errors?.length || !payload.data) {
      throw new Error(payload.errors?.[0]?.message ?? `Warcraft Logs request failed (${response.status}).`);
    }
    return payload.data;
  }
  throw new Error("Warcraft Logs is temporarily rate limiting analysis requests. Try recalculating again in a moment.");
}

export async function fetchReportOverview(code: string, credentials: WarcraftLogsCredentials) {
  const token = await getAccessToken(credentials);
  const data = await graphQL<{ reportData: { report: WclReportOverview | null } }>(token, `
    query ReportOverview($code: String!) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          code title startTime endTime visibility
          zone { name }
          fights {
            id name encounterID startTime endTime difficulty kill bossPercentage averageItemLevel friendlyPlayers friendlySpecs
            gameZone { id name }
            keystoneAffixes rating
          }
          masterData {
            actors(type: "Player") { id name type subType server }
            abilities { gameID name icon }
          }
          rankings
        }
      }
    }
  `, { code });
  if (!data.reportData.report) throw new Error(`Report ${code} was not found or is not public.`);
  return { report: data.reportData.report, token };
}

export async function fetchReportPreview(code: string, credentials: WarcraftLogsCredentials) {
  const token = await getAccessToken(credentials);
  const data = await graphQL<{ reportData: { report: WclReportOverview | null } }>(token, `
    query ReportPreview($code: String!) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          code title startTime endTime visibility
          zone { name }
          fights {
            id name encounterID startTime endTime difficulty kill bossPercentage friendlyPlayers
            gameZone { id name }
            keystoneAffixes rating
          }
          masterData { actors(type: "Player") { id name type subType server } }
        }
      }
    }
  `, { code });
  const report = data.reportData.report;
  if (!report) throw new Error(`Report ${code} was not found, public, or unlisted.`);
  const fights = report.fights.filter((fight) => fight.encounterID > 0);
  const participatingPlayerIds = new Set(fights.flatMap((fight) => fight.friendlyPlayers ?? []));
  const bossMap = new Map<string, { name: string; pulls: number; kills: number }>();
  for (const fight of fights) {
    const entry = bossMap.get(fight.name) ?? { name: fight.name, pulls: 0, kills: 0 };
    entry.pulls += 1;
    if (fight.kill) entry.kills += 1;
    bossMap.set(fight.name, entry);
  }
  const grouped = new Map<string, WclImportPreview["groups"][number]>();
  const pullNumbers = new Map<string, number>();
  for (const fight of fights) {
    const kind = classifyFight(fight);
    const zoneName = fight.gameZone?.name ?? report.zone?.name ?? "Unknown content";
    const difficulty = kind === "mythic_plus" ? "Mythic+" : difficultyNames[fight.difficulty ?? 0] ?? "Other";
    const key = kind === "mythic_plus"
      ? `${kind}:${fight.gameZone?.id ?? zoneName}`
      : `${kind}:${fight.gameZone?.id ?? zoneName}:${fight.difficulty ?? 0}:${fight.encounterID}`;
    const nextPull = (pullNumbers.get(key) ?? 0) + 1;
    pullNumbers.set(key, nextPull);
    const group = grouped.get(key) ?? {
      id: key,
      label: kind === "mythic_plus" ? `${zoneName} · Mythic+` : `${difficulty} · ${fight.name}`,
      description: kind === "mythic_plus" ? "Dungeon content · unchecked by default" : `${zoneName} · ${kind === "raid" ? "Raid encounter" : "Other encounter"}`,
      kind,
      defaultSelected: kind === "raid",
      fights: [],
    };
    group.fights.push({
      id: fight.id,
      name: fight.name,
      pullNumber: nextPull,
      difficulty,
      duration: fightDuration(fight.startTime, fight.endTime),
      result: fight.kill ? "Kill" : fight.bossPercentage !== null && fight.bossPercentage !== undefined ? `${fight.bossPercentage.toFixed(1)}%` : "Wipe",
      playerCount: fight.friendlyPlayers?.length ?? 0,
    });
    grouped.set(key, group);
  }
  const preview: WclImportPreview = {
    code: report.code,
    title: report.title,
    raid: report.zone?.name ?? "Unknown raid",
    visibility: report.visibility,
    startedAt: report.startTime,
    pullCount: fights.length,
    playerCount: participatingPlayerIds.size,
    bosses: [...bossMap.values()],
    groups: [...grouped.values()],
  };
  return preview;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseRankingRows(rankings: unknown): WclRankingRow[] {
  const rows = new Map<string, WclRankingRow>();
  function walk(value: unknown, context: { fightId?: number; role?: string } = {}) {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, context));
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const fightId = numberOrNull(object.fightID ?? object.fightId) ?? context.fightId;
    const role = typeof object.role === "string" ? object.role : context.role;
    const name = typeof object.name === "string" ? object.name : null;
    const parse = numberOrNull(object.rankPercent ?? object.percentile ?? object.historicalPercent);
    const ilvlParse = numberOrNull(object.bracketPercent ?? object.itemLevelPercent);
    if (fightId && name && (parse !== null || ilvlParse !== null)) {
      const key = `${fightId}:${name.toLowerCase()}`;
      const candidate: WclRankingRow = {
        fightId,
        name,
        role,
        spec: typeof object.spec === "string" ? object.spec : undefined,
        parse,
        ilvlParse,
        amount: numberOrNull(object.amount),
      };
      const current = rows.get(key);
      if (!current || (candidate.parse !== null && current.parse === null)) rows.set(key, candidate);
    }
    for (const [key, child] of Object.entries(object)) {
      const childRole = /heal/i.test(key) ? "Healer" : /tank/i.test(key) ? "Tank" : /dps|damage/i.test(key) ? "DPS" : role;
      walk(child, { fightId, role: childRole });
    }
  }
  walk(rankings);
  return [...rows.values()];
}

export async function fetchFightEvents(code: string, fightId: number, abilityId: number, token: string) {
  const data = await graphQL<{ reportData: { report: { events: { data: unknown[]; nextPageTimestamp?: number | null } } | null } }>(token, `
    query RelevantEvents($code: String!, $fightId: Int!, $abilityId: Float!) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          events(fightIDs: [$fightId], abilityID: $abilityId, limit: 10000) { data nextPageTimestamp }
        }
      }
    }
  `, { code, fightId, abilityId });
  return data.reportData.report?.events.data ?? [];
}

export async function fetchFightEventsBatch(code: string, fightId: number, abilityIds: number[], token: string) {
  const uniqueIds = [...new Set(abilityIds.filter((abilityId) => Number.isInteger(abilityId) && abilityId > 0))];
  if (!uniqueIds.length) return new Map<number, unknown[]>();
  const variables: Record<string, unknown> = { code, fightId };
  const declarations = uniqueIds.map((_, index) => `$ability${index}: Float!`).join(", ");
  const fields = uniqueIds.map((abilityId, index) => {
    variables[`ability${index}`] = abilityId;
    return `events${index}: events(fightIDs: [$fightId], abilityID: $ability${index}, limit: 10000) { data }`;
  }).join("\n");
  const data = await graphQL<{ reportData: { report: Record<string, { data?: unknown[] }> | null } }>(token, `
    query RelevantEventBatch($code: String!, $fightId: Int!, ${declarations}) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          ${fields}
        }
      }
    }
  `, variables);
  const report = data.reportData.report ?? {};
  return new Map(uniqueIds.map((abilityId, index) => [abilityId, report[`events${index}`]?.data ?? []]));
}

export async function fetchFightAnalysisEvents(code: string, fightId: number, abilityIds: number[], token: string) {
  const uniqueIds = [...new Set(abilityIds.filter((abilityId) => Number.isInteger(abilityId) && abilityId > 0))];
  const variables: Record<string, unknown> = { code, fightId };
  const declarations = uniqueIds.map((_, index) => `$ability${index}: Float!`).join(", ");
  const fields = uniqueIds.map((abilityId, index) => {
    variables[`ability${index}`] = abilityId;
    return `events${index}: events(fightIDs: [$fightId], abilityID: $ability${index}, limit: 10000) { data }`;
  }).join("\n");
  type EventPage = { data?: unknown[] };
  const data = await graphQL<{ reportData: { report: Record<string, EventPage> | null } }>(token, `
    query FightAnalysis($code: String!, $fightId: Int!${declarations ? `, ${declarations}` : ""}) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          deaths: events(fightIDs: [$fightId], dataType: Deaths, limit: 1000) { data }
          interrupts: events(fightIDs: [$fightId], dataType: Interrupts, limit: 1000) { data }
          dispels: events(fightIDs: [$fightId], dataType: Dispels, limit: 1000) { data }
          ${fields}
        }
      }
    }
  `, variables);
  const report = data.reportData.report ?? {};
  return {
    deaths: report.deaths?.data ?? [],
    interrupts: report.interrupts?.data ?? [],
    dispels: report.dispels?.data ?? [],
    eventsByAbility: new Map(uniqueIds.map((abilityId, index) => [abilityId, report[`events${index}`]?.data ?? []])),
  };
}

export type RuleEventFilter = { spellId: number; eventType: string };

export async function fetchRuleEvents(code: string, fightIds: number[], filters: RuleEventFilter[], token: string) {
  const validFilters = filters.filter((filter) => Number.isInteger(filter.spellId) && filter.spellId > 0);
  if (!validFilters.length || !fightIds.length) return [];
  const clauses: string[] = [];
  const eventTypes = ["damage", "debuff", "cast", "dispel", "interrupt", "death"];
  for (const eventType of eventTypes) {
    const ids = [...new Set(validFilters.filter((filter) => filter.eventType === eventType).map((filter) => filter.spellId))];
    if (!ids.length) continue;
    const idList = ids.join(", ");
    if (eventType === "damage") clauses.push(`(type = "damage" AND ability.id IN (${idList}))`);
    if (eventType === "debuff") clauses.push(`(type IN ("applydebuff", "applydebuffstack", "refreshdebuff") AND ability.id IN (${idList}))`);
    if (eventType === "cast") clauses.push(`(type IN ("cast", "begincast") AND ability.id IN (${idList}))`);
    if (eventType === "dispel") clauses.push(`(type = "dispel" AND stoppedAbility.id IN (${idList}))`);
    if (eventType === "interrupt") clauses.push(`(type = "interrupt" AND stoppedAbility.id IN (${idList}))`);
    if (eventType === "death") clauses.push(`(type = "death" AND killingAbility.id IN (${idList}))`);
  }
  if (!clauses.length) return [];
  const filterExpression = clauses.join(" OR ");
  const data = await graphQL<{ reportData: { report: { events: { data?: unknown[] } } | null } }>(token, `
    query RuleEvents($code: String!, $fightIds: [Int], $filterExpression: String!) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          events(fightIDs: $fightIds, dataType: All, filterExpression: $filterExpression, limit: 10000, translate: false) { data }
        }
      }
    }
  `, { code, fightIds, filterExpression });
  return data.reportData.report?.events.data ?? [];
}

export function groupRuleEventsByAbility(events: unknown[], abilityIds: number[]) {
  const wanted = new Set(abilityIds);
  const grouped = new Map(abilityIds.map((abilityId) => [abilityId, [] as unknown[]]));
  for (const raw of events) {
    const event = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const candidates = [
      event.abilityGameID,
      event.abilityID,
      event.extraAbilityGameID,
      event.extraAbilityID,
      event.killingAbilityGameID,
      event.killingAbilityID,
    ].map(Number).filter((abilityId) => Number.isInteger(abilityId) && wanted.has(abilityId));
    for (const abilityId of new Set(candidates)) grouped.get(abilityId)?.push(raw);
  }
  return grouped;
}

export async function fetchFightContextEvents(code: string, fightId: number, token: string) {
  type EventPage = { data: unknown[] };
  const data = await graphQL<{ reportData: { report: { deaths: EventPage; interrupts: EventPage; dispels: EventPage } | null } }>(token, `
    query FightContext($code: String!, $fightId: Int!) {
      reportData {
        report(code: $code, allowUnlisted: true) {
          deaths: events(fightIDs: [$fightId], dataType: Deaths, limit: 1000) { data }
          interrupts: events(fightIDs: [$fightId], dataType: Interrupts, limit: 1000) { data }
          dispels: events(fightIDs: [$fightId], dataType: Dispels, limit: 1000) { data }
        }
      }
    }
  `, { code, fightId });
  return {
    deaths: data.reportData.report?.deaths.data ?? [],
    interrupts: data.reportData.report?.interrupts.data ?? [],
    dispels: data.reportData.report?.dispels.data ?? [],
  };
}
