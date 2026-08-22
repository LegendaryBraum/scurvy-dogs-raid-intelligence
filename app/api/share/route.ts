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
    const player = raidData.players.find((candidate) => candidate.id === payload.playerId) ?? raidData.players[0];
    const db = await ensureSchema();
    const playerId = await stablePlayerId(player.name, player.realm);
    const token = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare("INSERT INTO players (id, name, realm, class_name, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, realm) DO UPDATE SET class_name = excluded.class_name, role = excluded.role")
        .bind(playerId, player.name, player.realm, player.className, player.role),
      db.prepare("INSERT INTO shares (token, player_id, expires_at) VALUES (?, ?, ?)").bind(token, playerId, expiresAt),
    ]);
    return Response.json({ token, url: `/share/${token}`, expiresAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Private view could not be created." }, { status: 500 });
  }
}
