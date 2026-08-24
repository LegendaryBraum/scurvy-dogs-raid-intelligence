import { ensureSchema } from "../../../../db/runtime";
import { clearOfficerSessionCookie, getOfficerSession, officerRequiredResponse } from "../../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const session = await getOfficerSession(request);
    if (!session) return officerRequiredResponse();
    return Response.json({ authorized: true, officer: { name: session.officerName, deviceLabel: session.deviceLabel, sessionId: session.id } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Officer access could not be checked." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getOfficerSession(request, false);
    if (session) {
      const db = await ensureSchema();
      await db.prepare("UPDATE officer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(session.id).run();
    }
    return Response.json({ revoked: true }, { headers: { "Set-Cookie": clearOfficerSessionCookie(), "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "This device could not be signed out." }, { status: 500 });
  }
}
