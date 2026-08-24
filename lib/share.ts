import { ensureSchema } from "../db/runtime";
import { loadLatestDashboardData } from "./dashboard-data";
import type { PlayerSnapshot } from "./types";

export async function getSharedPlayer(token: string): Promise<PlayerSnapshot | null> {
  try {
    const db = await ensureSchema();
    const livingAccess = await db.prepare(`
      SELECT p.id, p.name, p.realm, p.class_name AS className, p.role
      FROM player_access_links pal
      JOIN players p ON p.id = pal.player_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE pal.token = ? AND pal.revoked_at IS NULL AND COALESCE(prs.included, 1) = 1
    `).bind(token).first<{ id: string; name: string; realm: string; className: string; role: string }>();
    if (livingAccess) {
      await db.prepare("UPDATE player_access_links SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?").bind(token).run();
      const latestNight = await db.prepare(`
        SELECT rn.id
        FROM pull_players pp
        JOIN pulls pu ON pu.id = pp.pull_id
        JOIN reports r ON r.id = pu.report_id
        JOIN raid_nights rn ON rn.id = r.raid_night_id
        WHERE pp.player_id = ? AND pu.included = 1 AND r.included = 1 AND rn.included = 1
        ORDER BY rn.happened_at DESC, pu.start_time DESC LIMIT 1
      `).bind(livingAccess.id).first<{ id: string }>();
      const dashboard = await loadLatestDashboardData(latestNight?.id);
      const pullId = dashboard?.pulls.find((pull) => dashboard.pullPlayers?.[pull.id]?.some((player) => player.id === livingAccess.id))?.id;
      const imported = pullId ? dashboard?.pullPlayers?.[pullId]?.find((player) => player.id === livingAccess.id) : undefined;
      if (imported) {
        const comparisonPlayers = dashboard?.pullPlayers?.[pullId ?? ""] ?? [];
        const average = (key: keyof PlayerSnapshot["scores"]) => {
          const values = comparisonPlayers.map((player) => player.scores[key]).filter((value): value is number => value !== null);
          return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
        };
        return { ...imported, raidNightLabel: dashboard?.raidNight, enabledModules: dashboard?.moduleSettings, raidAverages: { mechanics: average("mechanics"), performance: average("performance"), attendance: average("attendance"), preparation: average("preparation") } };
      }
      return {
        id: livingAccess.id, name: livingAccess.name, realm: livingAccess.realm, className: livingAccess.className, spec: livingAccess.role, role: livingAccess.role as PlayerSnapshot["role"],
        scores: { mechanics: null, performance: null, attendance: null, preparation: null }, parse: null, ilvlParse: null,
        attendanceLabel: "No active pull yet", prepLabel: "Not evaluated", trend: [], enabledModules: dashboard?.moduleSettings,
        raidNightLabel: dashboard?.raidNight, summary: "This living player link is active. Their next included raid data will appear here automatically.",
        wins: ["Private player access is active"], focus: ["No included pull is currently available"], deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
      };
    }
    const row = await db.prepare(`
      SELECT p.id, p.name, p.realm, p.class_name AS className, p.role, s.pull_id AS pullId, s.expires_at AS expiresAt, r.raid_night_id AS raidNightId
      FROM shares s
      JOIN players p ON p.id = s.player_id
      LEFT JOIN pulls pu ON pu.id = s.pull_id
      LEFT JOIN reports r ON r.id = pu.report_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE s.token = ? AND COALESCE(prs.included, 1) = 1
    `).bind(token).first<{ id: string; name: string; realm: string; className: string; role: string; pullId: string | null; expiresAt: string | null; raidNightId: string | null }>();
    if (!row || (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) return null;
    const dashboard = await loadLatestDashboardData(row.raidNightId);
    const imported = row.pullId ? dashboard?.pullPlayers?.[row.pullId]?.find((player) => player.id === row.id) : undefined;
    if (imported) {
      const comparisonPlayers = dashboard?.pullPlayers?.[row.pullId ?? ""] ?? [];
      const average = (key: keyof PlayerSnapshot["scores"]) => {
        const values = comparisonPlayers.map((player) => player.scores[key]).filter((value): value is number => value !== null);
        return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
      };
      return { ...imported, raidNightLabel: dashboard?.raidNight, enabledModules: dashboard?.moduleSettings, raidAverages: { mechanics: average("mechanics"), performance: average("performance"), attendance: average("attendance"), preparation: average("preparation") } };
    }
    return {
      id: token, name: row.name, realm: row.realm, className: row.className, spec: row.role, role: row.role as PlayerSnapshot["role"],
      scores: { mechanics: 100, performance: null, attendance: 100, preparation: null }, parse: null, ilvlParse: null,
      attendanceLabel: "Imported", prepLabel: "Not evaluated", trend: [100],
      enabledModules: dashboard?.moduleSettings, raidNightLabel: dashboard?.raidNight,
      summary: "This player has been imported. Detailed scoring will appear after encounter rules match their events.",
      wins: ["Report data imported successfully"], focus: ["No configured mechanic findings yet"], deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
    };
  } catch { return null; }
}
