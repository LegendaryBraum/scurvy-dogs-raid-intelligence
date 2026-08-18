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
  masterData?: { actors?: Array<{ id: number; name: string; type: string; subType: string; server?: string | null }> | null } | null;
  rankings?: unknown;
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
        report(code: $code) {
          code title startTime endTime visibility
          zone { name }
          fights {
            id name encounterID startTime endTime difficulty kill bossPercentage averageItemLevel friendlyPlayers friendlySpecs
          }
          masterData { actors(type: "Player") { id name type subType server } }
          rankings
        }
      }
    }
  `, { code });
  if (!data.reportData.report) throw new Error(`Report ${code} was not found or is not public.`);
  return { report: data.reportData.report, token };
}

export async function fetchFightEvents(code: string, fightId: number, abilityId: number, token: string) {
  const data = await graphQL<{ reportData: { report: { events: { data: unknown[]; nextPageTimestamp?: number | null } } | null } }>(token, `
    query RelevantEvents($code: String!, $fightId: Int!, $abilityId: Float!) {
      reportData {
        report(code: $code) {
          events(fightIDs: [$fightId], abilityID: $abilityId, limit: 10000) { data nextPageTimestamp }
        }
      }
    }
  `, { code, fightId, abilityId });
  return data.reportData.report?.events.data ?? [];
}
