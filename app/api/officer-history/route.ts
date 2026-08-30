import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";
import type { OfficerBossHistory, OfficerHistoryKill, OfficerPlayerHistory, ScoreValue } from "../../../lib/types";

export const runtime = "edge";

type PlayerRow = {
  player_id: string;
  name: string;
  realm: string;
  class_name: string;
  role: string;
  spec: string;
  pulls: number;
  nights: number;
  last_seen_at: string;
  mechanics: number | null;
  performance: number | null;
  preparation: number | null;
};

type BossRow = {
  player_id: string;
  boss_id: string;
  boss_name: string;
  pulls: number;
  kills: number;
  last_seen_at: string;
  mechanics: number | null;
  performance: number | null;
  preparation: number | null;
  dps: number | null;
  hps: number | null;
};

type KillRow = {
  player_id: string;
  pull_id: string;
  boss_id: string;
  raid_night_id: string;
  raid_night_name: string;
  happened_at: string;
  difficulty: number | null;
  character_name: string;
  spec: string;
  mechanics: number | null;
  performance: number | null;
  preparation: number | null;
  parse: number | null;
  ilvl_parse: number | null;
  dps: number | null;
  hps: number | null;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };
const rounded = (value: number | null): ScoreValue => value === null ? null : Math.round(value);
const role = (value: string): OfficerPlayerHistory["role"] => value === "Tank" || value === "Healer" ? value : "DPS";

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    const season = await db.prepare(`
      SELECT rn.season_id
      FROM raid_nights rn
      JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live' AND r.included = 1
      JOIN pulls pu ON pu.report_id = r.id AND pu.included = 1
      WHERE rn.included = 1
      ORDER BY rn.happened_at DESC, pu.start_time DESC
      LIMIT 1
    `).first<{ season_id: string }>();
    if (!season) return Response.json({ players: [], totalRaidNights: 0 }, { headers: { "Cache-Control": "no-store" } });

    const [nightCount, playerResult, bossResult, killResult] = await Promise.all([
      db.prepare(`
        SELECT COUNT(DISTINCT rn.id) AS count
        FROM raid_nights rn
        JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live' AND r.included = 1
        JOIN pulls pu ON pu.report_id = r.id AND pu.included = 1
        WHERE rn.season_id = ? AND rn.included = 1
      `).bind(season.season_id).first<{ count: number }>(),
      db.prepare(`
        SELECT identity_player.id AS player_id, identity_player.name, identity_player.realm,
               identity_player.class_name, identity_player.role, MAX(pp.spec) AS spec,
               COUNT(DISTINCT pu.id) AS pulls, COUNT(DISTINCT rn.id) AS nights,
               MAX(rn.happened_at) AS last_seen_at,
               AVG(CASE WHEN EXISTS (
                 SELECT 1 FROM mechanic_rules mr WHERE mr.boss_id = pu.boss_id AND mr.enabled = 1
               ) THEN pp.mechanics_score END) AS mechanics,
               AVG(NULLIF(pp.performance_score, 0)) AS performance,
               AVG(NULLIF(pp.preparation_score, 0)) AS preparation
        FROM pull_players pp
        JOIN players p ON p.id = pp.player_id
        LEFT JOIN player_identities pi ON pi.player_id = p.id
        JOIN players identity_player ON identity_player.id = COALESCE(pi.identity_id, p.id)
        LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
        JOIN pulls pu ON pu.id = pp.pull_id AND pu.included = 1
        JOIN reports r ON r.id = pu.report_id AND r.source_mode = 'live' AND r.included = 1
        JOIN raid_nights rn ON rn.id = r.raid_night_id AND rn.included = 1
        WHERE rn.season_id = ? AND COALESCE(prs.included, 1) = 1
        GROUP BY identity_player.id, identity_player.name, identity_player.realm, identity_player.class_name, identity_player.role
        ORDER BY identity_player.name
      `).bind(season.season_id).all<PlayerRow>(),
      db.prepare(`
        SELECT identity_player.id AS player_id, b.id AS boss_id, b.name AS boss_name,
               COUNT(DISTINCT pu.id) AS pulls,
               COUNT(DISTINCT CASE WHEN pu.killed = 1 THEN pu.id END) AS kills,
               MAX(rn.happened_at) AS last_seen_at,
               AVG(CASE WHEN EXISTS (
                 SELECT 1 FROM mechanic_rules mr WHERE mr.boss_id = pu.boss_id AND mr.enabled = 1
               ) THEN pp.mechanics_score END) AS mechanics,
               AVG(NULLIF(pp.performance_score, 0)) AS performance,
               AVG(NULLIF(pp.preparation_score, 0)) AS preparation,
               AVG(NULLIF(pp.dps, 0)) AS dps,
               AVG(NULLIF(pp.hps, 0)) AS hps
        FROM pull_players pp
        JOIN players p ON p.id = pp.player_id
        LEFT JOIN player_identities pi ON pi.player_id = p.id
        JOIN players identity_player ON identity_player.id = COALESCE(pi.identity_id, p.id)
        LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
        JOIN pulls pu ON pu.id = pp.pull_id AND pu.included = 1
        JOIN bosses b ON b.id = pu.boss_id
        JOIN reports r ON r.id = pu.report_id AND r.source_mode = 'live' AND r.included = 1
        JOIN raid_nights rn ON rn.id = r.raid_night_id AND rn.included = 1
        WHERE rn.season_id = ? AND COALESCE(prs.included, 1) = 1
        GROUP BY identity_player.id, b.id, b.name
        ORDER BY identity_player.name, MAX(rn.happened_at) DESC, b.name
      `).bind(season.season_id).all<BossRow>(),
      db.prepare(`
        SELECT identity_player.id AS player_id, pu.id AS pull_id, pu.boss_id, rn.id AS raid_night_id,
               rn.name AS raid_night_name, rn.happened_at, pu.difficulty,
               p.name AS character_name, pp.spec,
               CASE WHEN EXISTS (
                 SELECT 1 FROM mechanic_rules mr WHERE mr.boss_id = pu.boss_id AND mr.enabled = 1
               ) THEN pp.mechanics_score END AS mechanics,
               NULLIF(pp.performance_score, 0) AS performance,
               NULLIF(pp.preparation_score, 0) AS preparation,
               NULLIF(pp.parse, 0) AS parse, NULLIF(pp.ilvl_parse, 0) AS ilvl_parse,
               NULLIF(pp.dps, 0) AS dps, NULLIF(pp.hps, 0) AS hps
        FROM pull_players pp
        JOIN players p ON p.id = pp.player_id
        LEFT JOIN player_identities pi ON pi.player_id = p.id
        JOIN players identity_player ON identity_player.id = COALESCE(pi.identity_id, p.id)
        LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
        JOIN pulls pu ON pu.id = pp.pull_id AND pu.included = 1 AND pu.killed = 1
        JOIN reports r ON r.id = pu.report_id AND r.source_mode = 'live' AND r.included = 1
        JOIN raid_nights rn ON rn.id = r.raid_night_id AND rn.included = 1
        WHERE rn.season_id = ? AND COALESCE(prs.included, 1) = 1
        ORDER BY rn.happened_at DESC, pu.start_time DESC
      `).bind(season.season_id).all<KillRow>(),
    ]);

    const totalRaidNights = Number(nightCount?.count ?? 0);
    const killsByPlayerAndBoss = new Map<string, OfficerHistoryKill[]>();
    for (const row of killResult.results) {
      const key = `${row.player_id}:${row.boss_id}`;
      (killsByPlayerAndBoss.get(key) ?? killsByPlayerAndBoss.set(key, []).get(key)!).push({
        pullId: row.pull_id,
        raidNightId: row.raid_night_id,
        raidNightName: row.raid_night_name,
        happenedAt: row.happened_at,
        difficulty: difficultyNames[row.difficulty ?? 0] ?? "Unknown",
        characterName: row.character_name,
        spec: row.spec,
        scores: { mechanics: rounded(row.mechanics), performance: rounded(row.performance), attendance: null, preparation: rounded(row.preparation) },
        parse: rounded(row.parse),
        ilvlParse: rounded(row.ilvl_parse),
        dps: rounded(row.dps),
        hps: rounded(row.hps),
      });
    }

    const bossesByPlayer = new Map<string, OfficerBossHistory[]>();
    for (const row of bossResult.results) {
      const history: OfficerBossHistory = {
        bossId: row.boss_id,
        bossName: row.boss_name,
        pulls: Number(row.pulls),
        kills: Number(row.kills),
        lastSeenAt: row.last_seen_at,
        scores: { mechanics: rounded(row.mechanics), performance: rounded(row.performance), attendance: null, preparation: rounded(row.preparation) },
        averageDps: rounded(row.dps),
        averageHps: rounded(row.hps),
        killHistory: killsByPlayerAndBoss.get(`${row.player_id}:${row.boss_id}`) ?? [],
      };
      (bossesByPlayer.get(row.player_id) ?? bossesByPlayer.set(row.player_id, []).get(row.player_id)!).push(history);
    }

    const players: OfficerPlayerHistory[] = playerResult.results.map((row) => ({
      playerId: row.player_id,
      name: row.name,
      realm: row.realm,
      className: row.class_name,
      spec: row.spec,
      role: role(row.role),
      pulls: Number(row.pulls),
      nightsAttended: Number(row.nights),
      totalRaidNights,
      lastSeenAt: row.last_seen_at,
      scores: {
        mechanics: rounded(row.mechanics),
        performance: rounded(row.performance),
        attendance: totalRaidNights ? Math.round(Number(row.nights) / totalRaidNights * 100) : null,
        preparation: rounded(row.preparation),
      },
      bosses: bossesByPlayer.get(row.player_id) ?? [],
    }));
    return Response.json({ players, totalRaidNights }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Officer history could not be loaded." }, { status: 500 });
  }
}
