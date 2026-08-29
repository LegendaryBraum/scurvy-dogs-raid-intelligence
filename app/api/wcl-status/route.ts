import { getRuntimeEnv } from "../../../db/runtime";
import { fetchRateLimitStatus, WarcraftLogsRateLimitError } from "../../../lib/warcraft-logs";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const runtimeEnv = getRuntimeEnv();
    if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) {
      return Response.json({ error: "The Warcraft Logs connection is not available.", state: "unavailable" }, { status: 503 });
    }
    const allowance = await fetchRateLimitStatus({
      clientId: runtimeEnv.WCL_CLIENT_ID,
      clientSecret: runtimeEnv.WCL_CLIENT_SECRET,
    });
    return Response.json(allowance, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WarcraftLogsRateLimitError) {
      return Response.json({
        error: error.message,
        state: "full",
        percentRemaining: 0,
        pointsResetIn: error.retryAfterSeconds,
      }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({
      error: error instanceof Error ? error.message : "Warcraft Logs allowance could not be checked.",
      state: "unavailable",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
