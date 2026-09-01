import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";
import { buildCalibrationPreview, parseWipefestUrl } from "../../../lib/wipefest-calibration";

export const runtime = "edge";

type BossRow = { id: string; name: string; encounter_id: number };
type ExistingRuleRow = { spell_id: number; event_type: string; difficulties_json: string };

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const body = await request.json() as { wipefestUrl?: string };
    if (!body.wipefestUrl?.trim()) return Response.json({ error: "Paste one specific Wipefest fight link." }, { status: 400 });
    const parsed = parseWipefestUrl(body.wipefestUrl);
    const wipefestResponse = await fetch(`https://api.wipefest.gg/report/${encodeURIComponent(parsed.reportCode)}/fight/${parsed.fightId}?gameVersion=warcraft-live`, {
      headers: { Accept: "application/json" },
    });
    if (!wipefestResponse.ok) {
      return Response.json({ error: wipefestResponse.status === 404 ? "Wipefest could not find that pull." : `Wipefest could not read that pull (${wipefestResponse.status}).` }, { status: 502 });
    }
    const payload = await wipefestResponse.json() as unknown;
    const info = payload && typeof payload === "object" ? (payload as Record<string, unknown>).info as Record<string, unknown> | undefined : undefined;
    const encounterId = Number(info?.boss);
    if (!Number.isInteger(encounterId) || encounterId <= 0) return Response.json({ error: "Wipefest did not identify a raid boss for that pull." }, { status: 422 });
    const db = await ensureSchema();
    const boss = await db.prepare(`
      SELECT b.id, b.name, b.encounter_id
      FROM bosses b
      LEFT JOIN seasons s ON s.id = b.season_id
      WHERE b.encounter_id = ?
      ORDER BY COALESCE(s.active, 0) DESC,
               EXISTS (SELECT 1 FROM pulls p WHERE p.boss_id = b.id AND p.included = 1) DESC
      LIMIT 1
    `).bind(encounterId).first<BossRow>();
    if (!boss) return Response.json({ error: `${String(info?.name ?? "That boss")} is not in the raid data yet. Import a Warcraft Logs pull for it first, then use this Wipefest link again.` }, { status: 409 });
    const existing = await db.prepare("SELECT spell_id, event_type, difficulties_json FROM mechanic_rules WHERE boss_id = ?").bind(boss.id).all<ExistingRuleRow>();
    const preview = buildCalibrationPreview({ payload, sourceUrl: parsed.sourceUrl, bossId: boss.id, existingRules: existing.results });
    if (!preview.candidates.length) return Response.json({ error: "Wipefest returned the fight, but no reviewable encounter mechanics were found." }, { status: 422 });
    return Response.json({ preview });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Wipefest pull could not be read." }, { status: 500 });
  }
}
