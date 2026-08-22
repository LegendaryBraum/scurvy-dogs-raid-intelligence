import { ensureSchema } from "../db/runtime";
import { raidData } from "./raid-data";
import type { PlayerSnapshot } from "./types";

export async function getSharedPlayer(token: string): Promise<PlayerSnapshot | null> {
  try {
    const db = await ensureSchema();
    const row = await db.prepare(`
      SELECT p.name, p.realm, p.class_name AS className, p.role, s.expires_at AS expiresAt
      FROM shares s JOIN players p ON p.id = s.player_id
      WHERE s.token = ?
    `).bind(token).first<{ name: string; realm: string; className: string; role: string; expiresAt: string | null }>();
    if (!row || (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) return null;
    const snapshot = raidData.players.find((player) => player.name.toLowerCase() === row.name.toLowerCase());
    if (snapshot) return snapshot;
    return {
      id: token, name: row.name, realm: row.realm, className: row.className, spec: row.role, role: row.role as PlayerSnapshot["role"],
      scores: { mechanics: 100, performance: null, attendance: 100, preparation: null }, parse: null, ilvlParse: null,
      attendanceLabel: "Imported", prepLabel: "Not evaluated", trend: [100],
      summary: "This player has been imported. Detailed scoring will appear after encounter rules match their events.",
      wins: ["Report data imported successfully"], focus: ["No configured mechanic findings yet"], deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
    };
  } catch {
    return token === "demo-syflora" ? raidData.players[0] : null;
  }
}
