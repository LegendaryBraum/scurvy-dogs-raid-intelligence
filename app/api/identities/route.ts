import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { playerId?: string; identityId?: string };
    if (!payload.playerId || !payload.identityId) {
      return Response.json({ error: "Choose a character and the raider identity it belongs to." }, { status: 400 });
    }
    const db = await ensureSchema();
    const [player, target] = await Promise.all([
      db.prepare("SELECT p.id, COALESCE(pi.identity_id, p.id) AS identity_id FROM players p LEFT JOIN player_identities pi ON pi.player_id = p.id WHERE p.id = ?")
        .bind(payload.playerId).first<{ id: string; identity_id: string }>(),
      db.prepare("SELECT p.id, COALESCE(pi.identity_id, p.id) AS identity_id FROM players p LEFT JOIN player_identities pi ON pi.player_id = p.id WHERE p.id = ?")
        .bind(payload.identityId).first<{ id: string; identity_id: string }>(),
    ]);
    if (!player || !target) return Response.json({ error: "One of those characters is no longer available." }, { status: 404 });

    if (payload.playerId === payload.identityId) {
      const peers = await db.prepare(`
        SELECT p.id
        FROM player_identities pi
        JOIN players p ON p.id = pi.player_id
        WHERE pi.identity_id = ? AND pi.player_id != ?
        ORDER BY p.name, p.id
      `).bind(player.identity_id, player.id).all<{ id: string }>();
      const statements = [
        db.prepare("INSERT INTO player_identities (player_id, identity_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(player_id) DO UPDATE SET identity_id = excluded.identity_id, updated_at = CURRENT_TIMESTAMP")
          .bind(player.id, player.id),
      ];
      if (player.identity_id === player.id && peers.results.length) {
        const replacementIdentityId = peers.results[0].id;
        statements.unshift(db.prepare("UPDATE player_identities SET identity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE identity_id = ? AND player_id != ?")
          .bind(replacementIdentityId, player.identity_id, player.id));
      }
      await db.batch(statements);
    } else if (player.identity_id !== target.identity_id) {
      await db.batch([
        db.prepare("UPDATE player_identities SET identity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE identity_id = ?").bind(target.identity_id, player.identity_id),
        db.prepare("UPDATE officer_notes SET player_id = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?").bind(target.identity_id, player.identity_id),
      ]);
    }
    return Response.json({ linked: true, playerId: payload.playerId, identityId: payload.playerId === payload.identityId ? payload.playerId : target.identity_id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The character link could not be saved." }, { status: 500 });
  }
}
