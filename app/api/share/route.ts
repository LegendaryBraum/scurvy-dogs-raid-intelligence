import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse, randomAccessToken } from "../../../lib/officer-access";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { playerId?: string };
    if (!payload.playerId) return Response.json({ error: "Choose a player before creating their link." }, { status: 400 });
    const db = await ensureSchema();
    const storedPlayer = await db.prepare(`
      SELECT p.id, COALESCE(prs.included, 1) AS included
      FROM players p LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE p.id = ?
    `).bind(payload.playerId).first<{ id: string; included: number }>();
    if (!storedPlayer || !storedPlayer.included) return Response.json({ error: "Only active raiders can receive living player links." }, { status: 409 });
    let link = await db.prepare("SELECT token FROM player_access_links WHERE player_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .bind(storedPlayer.id).first<{ token: string }>();
    if (!link) {
      link = { token: randomAccessToken() };
      await db.prepare("INSERT INTO player_access_links (token, player_id) VALUES (?, ?)").bind(link.token, storedPlayer.id).run();
    }
    return Response.json({ token: link.token, url: `/share/${link.token}`, living: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Player access could not be created." }, { status: 500 });
  }
}
