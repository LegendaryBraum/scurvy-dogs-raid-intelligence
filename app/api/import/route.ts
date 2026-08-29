import { getRuntimeEnv } from "../../../db/runtime";
import { fetchReportPreview, parseReportUrls, WarcraftLogsRateLimitError } from "../../../lib/warcraft-logs";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { urls?: string[] | string; action?: "preview" };
    if (payload.action && payload.action !== "preview") {
      return Response.json({ error: "Imports now use the resumable import queue." }, { status: 409 });
    }
    const parsed = parseReportUrls(payload.urls ?? []);
    if (!parsed.reports.length) return Response.json({ error: "Add at least one valid Warcraft Logs report URL.", invalid: parsed.invalid }, { status: 400 });
    const runtimeEnv = getRuntimeEnv();
    if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) {
      return Response.json({ error: "The one-time Warcraft Logs connection has not been completed yet.", needsConnection: true }, { status: 503 });
    }
    const credentials = { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };
    const reports = await Promise.all(parsed.reports.map((report) => fetchReportPreview(report.code, credentials)));
    return Response.json({ reports, invalid: parsed.invalid, readyToImport: true });
  } catch (error) {
    if (error instanceof WarcraftLogsRateLimitError) {
      const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
      return Response.json({ error: error.message, rateLimited: true, retryAfterSeconds: error.retryAfterSeconds }, { status: 429, headers });
    }
    return Response.json({ error: error instanceof Error ? error.message : "The report could not be reviewed." }, { status: 500 });
  }
}
