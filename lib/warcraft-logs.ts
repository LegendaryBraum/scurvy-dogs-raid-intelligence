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
  }>;
  masterData?: {
    actors?: Array<{ id: number; name: string; type: string; subType: string; server?: string | null }> | null;
    abilities?: Array<{ gameID: number; name: string }> | null;
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
  const response = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message ?? `Warcraft Logs request failed (${response.status}).`);
  }
  return payload.data;
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
          }
          masterData {
            actors(type: "Player") { id name type subType server }
            abilities { gameID name }
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
          fights { id name encounterID startTime endTime difficulty kill bossPercentage friendlyPlayers }
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
  const preview: WclImportPreview = {
    code: report.code,
    title: report.title,
    raid: report.zone?.name ?? "Unknown raid",
    visibility: report.visibility,
    startedAt: report.startTime,
    pullCount: fights.length,
    playerCount: participatingPlayerIds.size,
    bosses: [...bossMap.values()],
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
