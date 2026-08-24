import { loadLatestDashboardData } from "../../../lib/dashboard-data";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const raidNightId = new URL(request.url).searchParams.get("raidNightId");
    const data = await loadLatestDashboardData(raidNightId);
    if (!data) return Response.json({ error: "No live report has been imported yet." }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The live dashboard could not be loaded." }, { status: 500 });
  }
}
