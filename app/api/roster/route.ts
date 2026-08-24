import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { playerId?: string; included?: boolean };
    if (!payload.playerId || typeof payload.included !== "boolean") {
      return Response.json({ error: "Choose a player and whether they should be included." }, { status: 400 });
    }

    const db = await ensureSchema();
    const player = await db.prepare("SELECT id, name FROM players WHERE id = ?")
      .bind(payload.playerId)
      .first<{ id: string; name: string }>();
    if (!player) return Response.json({ error: "That player is not in the imported roster." }, { status: 404 });

    if (!payload.included) {
      const active = await db.prepare(`
        SELECT COUNT(DISTINCT p.id) AS count
        FROM players p
        JOIN pull_players pp ON pp.player_id = p.id
        JOIN pulls pu ON pu.id = pp.pull_id
        JOIN reports r ON r.id = pu.report_id
        LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
        WHERE r.source_mode = 'live' AND COALESCE(prs.included, 1) = 1
      `).first<{ count: number }>();
      const alreadyIgnored = await db.prepare("SELECT included FROM player_roster_settings WHERE player_id = ?")
        .bind(payload.playerId)
        .first<{ included: number }>();
      if ((active?.count ?? 0) <= 1 && alreadyIgnored?.included !== 0) {
        return Response.json({ error: "Keep at least one active player in the roster." }, { status: 409 });
      }
    }

    await db.batch([
      db.prepare(`
        INSERT INTO player_roster_settings (player_id, included, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(player_id) DO UPDATE SET included = excluded.included, updated_at = CURRENT_TIMESTAMP
      `).bind(payload.playerId, payload.included ? 1 : 0),
      ...(payload.included ? [] : [db.prepare("DELETE FROM shares WHERE player_id = ?").bind(payload.playerId), db.prepare("UPDATE player_access_links SET revoked_at = CURRENT_TIMESTAMP WHERE player_id = ? AND revoked_at IS NULL").bind(payload.playerId)]),
    ]);

    return Response.json({ playerId: player.id, name: player.name, included: payload.included });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The roster could not be updated." }, { status: 500 });
  }
}
