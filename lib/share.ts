import { ensureSchema } from "../db/runtime";
import { raidData } from "./raid-data";
import { loadLatestDashboardData } from "./dashboard-data";
import type { PlayerSnapshot } from "./types";

export async function getSharedPlayer(token: string): Promise<PlayerSnapshot | null> {
  try {
    const db = await ensureSchema();
    const row = await db.prepare(`
      SELECT p.id, p.name, p.realm, p.class_name AS className, p.role, s.pull_id AS pullId, s.expires_at AS expiresAt
      FROM shares s
      JOIN players p ON p.id = s.player_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE s.token = ? AND COALESCE(prs.included, 1) = 1
    `).bind(token).first<{ id: string; name: string; realm: string; className: string; role: string; pullId: string | null; expiresAt: string | null }>();
    if (!row || (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) return null;
    const dashboard = await loadLatestDashboardData();
    const imported = row.pullId ? dashboard?.pullPlayers?.[row.pullId]?.find((player) => player.id === row.id) : undefined;
    if (imported) {
      const comparisonPlayers = dashboard?.pullPlayers?.[row.pullId ?? ""] ?? [];
      const average = (key: keyof PlayerSnapshot["scores"]) => {
        const values = comparisonPlayers.map((player) => player.scores[key]).filter((value): value is number => value !== null);
        return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
      };
      return { ...imported, enabledModules: dashboard?.moduleSettings, raidAverages: { mechanics: average("mechanics"), performance: average("performance"), attendance: average("attendance"), preparation: average("preparation") } };
    }
    const snapshot = raidData.players.find((player) => player.name.toLowerCase() === row.name.toLowerCase());
    if (snapshot) return { ...snapshot, enabledModules: raidData.moduleSettings };
    return {
      id: token, name: row.name, realm: row.realm, className: row.className, spec: row.role, role: row.role as PlayerSnapshot["role"],
      scores: { mechanics: 100, performance: null, attendance: 100, preparation: null }, parse: null, ilvlParse: null,
      attendanceLabel: "Imported", prepLabel: "Not evaluated", trend: [100],
      enabledModules: dashboard?.moduleSettings,
      summary: "This player has been imported. Detailed scoring will appear after encounter rules match their events.",
      wins: ["Report data imported successfully"], focus: ["No configured mechanic findings yet"], deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
    };
  } catch {
    return token === "demo-syflora" ? raidData.players[0] : null;
  }
}
