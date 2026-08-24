import { ensureSchema } from "../../../db/runtime";
import type { PlayerHistoryPoint } from "../../../lib/types";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type HistoryRow = {
  raid_night_id: string;
  label: string;
  happened_at: string;
  pulls: number;
  mechanics: number | null;
  performance: number | null;
  preparation: number | null;
  dps: number | null;
  hps: number | null;
};

function rounded(value: number | null) { return value === null ? null : Math.round(value); }

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const playerId = new URL(request.url).searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "Choose a player to view history." }, { status: 400 });
    const db = await ensureSchema();
    const identity = await db.prepare("SELECT p.id, p.name, COALESCE(pi.identity_id, p.id) AS identity_id FROM players p LEFT JOIN player_identities pi ON pi.player_id = p.id WHERE p.id = ?")
      .bind(playerId).first<{ id: string; name: string; identity_id: string }>();
    if (!identity) return Response.json({ error: "That player is no longer available." }, { status: 404 });
    const season = await db.prepare(`
      SELECT rn.season_id
      FROM raid_nights rn JOIN reports r ON r.raid_night_id = rn.id
      WHERE r.source_mode = 'live'
      ORDER BY rn.happened_at DESC LIMIT 1
    `).first<{ season_id: string }>();
    if (!season) return Response.json({ history: [], linkedCharacters: [identity.name] });

    const [historyResult, characterResult] = await Promise.all([
      db.prepare(`
        SELECT rn.id AS raid_night_id, rn.name AS label, rn.happened_at,
               COUNT(DISTINCT pp.pull_id) AS pulls,
               AVG(CASE WHEN EXISTS (SELECT 1 FROM mechanic_rules mr WHERE mr.boss_id = pu.boss_id AND mr.enabled = 1) THEN pp.mechanics_score END) AS mechanics,
               AVG(NULLIF(pp.performance_score, 0)) AS performance,
               AVG(NULLIF(pp.preparation_score, 0)) AS preparation,
               AVG(NULLIF(pp.dps, 0)) AS dps,
               AVG(NULLIF(pp.hps, 0)) AS hps
        FROM raid_nights rn
        JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live' AND r.included = 1
        LEFT JOIN pulls pu ON pu.report_id = r.id AND pu.included = 1
        LEFT JOIN pull_players pp ON pp.pull_id = pu.id AND pp.player_id IN (
          SELECT pi2.player_id FROM player_identities pi2 WHERE pi2.identity_id = ?
        )
        WHERE rn.season_id = ? AND rn.included = 1
        GROUP BY rn.id, rn.name, rn.happened_at
        ORDER BY rn.happened_at
      `).bind(identity.identity_id, season.season_id).all<HistoryRow>(),
      db.prepare(`
        SELECT p.name FROM players p
        JOIN player_identities pi ON pi.player_id = p.id
        WHERE pi.identity_id = ? ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.name
      `).bind(identity.identity_id, identity.identity_id).all<{ name: string }>(),
    ]);

    let attended = 0;
    const history: PlayerHistoryPoint[] = historyResult.results.map((row, index) => {
      const present = Number(row.pulls) > 0;
      if (present) attended += 1;
      return {
        raidNightId: row.raid_night_id,
        label: row.label,
        happenedAt: row.happened_at,
        present,
        pulls: Number(row.pulls),
        scores: {
          mechanics: rounded(row.mechanics),
          performance: rounded(row.performance),
          attendance: Math.round(attended / (index + 1) * 100),
          preparation: rounded(row.preparation),
        },
        dps: rounded(row.dps),
        hps: rounded(row.hps),
      };
    });
    return Response.json({ history, linkedCharacters: characterResult.results.map((row) => row.name) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Player history could not be loaded." }, { status: 500 });
  }
}
