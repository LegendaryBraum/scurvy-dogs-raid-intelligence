import { ensureSchema } from "../../../db/runtime";
import { raidData } from "../../../lib/raid-data";

export const runtime = "edge";

async function stablePlayerId(name: string, realm: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${name}|${realm}`.toLowerCase()));
  return `player_${Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { playerId?: string; bossId?: string; pullId?: string };
    const db = await ensureSchema();
    const storedPlayer = payload.playerId ? await db.prepare(`
      SELECT p.id, COALESCE(prs.included, 1) AS included
      FROM players p LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE p.id = ?
    `).bind(payload.playerId).first<{ id: string; included: number }>() : null;
    if (storedPlayer && !storedPlayer.included) {
      return Response.json({ error: "Ignored guests cannot receive player reports until they are restored to the roster." }, { status: 409 });
    }
    const fallback = raidData.players.find((candidate) => candidate.id === payload.playerId) ?? raidData.players[0];
    const playerId = storedPlayer?.id ?? await stablePlayerId(fallback.name, fallback.realm);
    const token = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const statements = [];
    if (!storedPlayer) statements.push(db.prepare("INSERT INTO players (id, name, realm, class_name, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, realm) DO UPDATE SET class_name = excluded.class_name, role = excluded.role")
      .bind(playerId, fallback.name, fallback.realm, fallback.className, fallback.role));
    statements.push(db.prepare("INSERT INTO shares (token, player_id, boss_id, pull_id, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(token, playerId, payload.bossId ?? null, payload.pullId ?? null, expiresAt));
    await db.batch(statements);
    return Response.json({ token, url: `/share/${token}`, expiresAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Private view could not be created." }, { status: 500 });
  }
}
