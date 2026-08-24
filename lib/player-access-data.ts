import { ensureSchema } from "../db/runtime";
import { loadLatestDashboardData } from "./dashboard-data";
import { loadPlayerHistory } from "./player-history";
import type { PlayerSnapshot, PrivatePlayerWorkspace, ScoreKey, ScoreValue } from "./types";

type AccessRow = { id: string; name: string; identity_id: string };
type NightRow = { id: string; name: string; happened_at: string; season_id: string };
const scoreKeys: ScoreKey[] = ["mechanics", "performance", "attendance", "preparation"];

function averages(players: PlayerSnapshot[]) {
  return Object.fromEntries(scoreKeys.map((key) => {
    const values = players.map((player) => player.scores[key]).filter((value): value is number => value !== null);
    return [key, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null];
  })) as Record<ScoreKey, ScoreValue>;
}

export async function loadPrivatePlayerWorkspace(token: string, selectedRaidNightId?: string | null): Promise<PrivatePlayerWorkspace | null> {
  const db = await ensureSchema();
  const access = await db.prepare(`
    SELECT p.id, p.name, COALESCE(pi.identity_id, p.id) AS identity_id
    FROM player_access_links pal
    JOIN players p ON p.id = pal.player_id
    LEFT JOIN player_identities pi ON pi.player_id = p.id
    LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
    WHERE pal.token = ? AND pal.revoked_at IS NULL AND COALESCE(prs.included, 1) = 1
  `).bind(token).first<AccessRow>();
  if (!access) return null;
  await db.prepare("UPDATE player_access_links SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?").bind(token).run();

  const [identityPlayers, nightResult] = await Promise.all([
    db.prepare(`SELECT p.id FROM players p LEFT JOIN player_identities pi ON pi.player_id = p.id WHERE COALESCE(pi.identity_id, p.id) = ?`).bind(access.identity_id).all<{ id: string }>(),
    db.prepare(`
      SELECT DISTINCT rn.id, rn.name, rn.happened_at, rn.season_id
      FROM raid_nights rn
      JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live' AND r.included = 1
      JOIN pulls pu ON pu.report_id = r.id AND pu.included = 1
      JOIN pull_players pp ON pp.pull_id = pu.id
      WHERE rn.included = 1 AND pp.player_id IN (
        SELECT p2.id FROM players p2 LEFT JOIN player_identities pi2 ON pi2.player_id = p2.id
        WHERE COALESCE(pi2.identity_id, p2.id) = ?
      )
      ORDER BY rn.happened_at DESC
    `).bind(access.identity_id).all<NightRow>(),
  ]);
  const nights = nightResult.results;
  if (!nights.length) return null;
  const selectedNight = nights.find((night) => night.id === selectedRaidNightId) ?? nights[0];
  const full = await loadLatestDashboardData(selectedNight.id);
  if (!full) return null;

  const allowedPlayerIds = new Set(identityPlayers.results.map((row) => row.id));
  allowedPlayerIds.add(access.id);
  const pulls = full.pulls.filter((pull) => (full.pullPlayers?.[pull.id] ?? []).some((player) => allowedPlayerIds.has(player.id)));
  if (!pulls.length) return null;
  const bossIds = new Set(pulls.map((pull) => pull.bossId));
  const pullPlayers: NonNullable<typeof full.pullPlayers> = {};
  const pullEvents: NonNullable<typeof full.pullEvents> = {};
  const pullRaidAverages: PrivatePlayerWorkspace["pullRaidAverages"] = {};
  for (const pull of pulls) {
    const allPlayers = full.pullPlayers?.[pull.id] ?? [];
    pullRaidAverages[pull.id] = averages(allPlayers);
    pullPlayers[pull.id] = allPlayers.filter((player) => allowedPlayerIds.has(player.id));
    pullEvents[pull.id] = (full.pullEvents?.[pull.id] ?? []).filter((event) => allowedPlayerIds.has(event.playerId));
  }
  const firstPull = pulls[0];
  const firstPlayers = pullPlayers[firstPull.id] ?? [];
  const historyData = await loadPlayerHistory(access.id, selectedNight.season_id);
  return {
    playerId: access.id,
    playerName: access.name,
    linkedCharacters: historyData?.linkedCharacters ?? [access.name],
    history: historyData?.history ?? [],
    pullRaidAverages,
    dashboard: {
      ...full,
      raidNights: nights.map((night) => ({ id: night.id, name: night.name, happenedAt: night.happened_at })),
      bosses: full.bosses.filter((boss) => bossIds.has(boss.id)),
      pulls,
      players: firstPlayers,
      roster: (full.roster ?? []).filter((player) => allowedPlayerIds.has(player.id)),
      events: pullEvents[firstPull.id] ?? [],
      pullPlayers,
      pullEvents,
      rules: full.rules.filter((rule) => bossIds.has(rule.bossId)),
      raidAverages: pullRaidAverages[firstPull.id],
    },
  };
}
