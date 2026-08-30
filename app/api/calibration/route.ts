import { ensureSchema } from "../../../db/runtime";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";
import { buildCalibrationPreview, parseWipefestUrl } from "../../../lib/wipefest-calibration";

export const runtime = "edge";

type BossRow = { id: string; name: string; encounter_id: number };
type ExistingRuleRow = { spell_id: number; event_type: string };

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const body = await request.json() as { wipefestUrl?: string; bossId?: string };
    if (!body.wipefestUrl?.trim() || !body.bossId) return Response.json({ error: "Choose a boss and paste one Wipefest fight link." }, { status: 400 });
    const parsed = parseWipefestUrl(body.wipefestUrl);
    const db = await ensureSchema();
    const boss = await db.prepare("SELECT id, name, encounter_id FROM bosses WHERE id = ?").bind(body.bossId).first<BossRow>();
    if (!boss) return Response.json({ error: "Import this boss before calibrating it." }, { status: 409 });

    const wipefestResponse = await fetch(`https://api.wipefest.gg/report/${encodeURIComponent(parsed.reportCode)}/fight/${parsed.fightId}?gameVersion=warcraft-live`, {
      headers: { Accept: "application/json" },
    });
    if (!wipefestResponse.ok) {
      return Response.json({ error: wipefestResponse.status === 404 ? "Wipefest could not find that pull." : `Wipefest could not read that pull (${wipefestResponse.status}).` }, { status: 502 });
    }
    const payload = await wipefestResponse.json() as unknown;
    const info = payload && typeof payload === "object" ? (payload as Record<string, unknown>).info as Record<string, unknown> | undefined : undefined;
    if (Number(info?.boss) !== Number(boss.encounter_id)) {
      return Response.json({ error: `That Wipefest link is for ${String(info?.name ?? "a different boss")}. Select ${String(info?.name ?? "that boss")} in Configure before reading it.` }, { status: 409 });
    }
    const existing = await db.prepare("SELECT spell_id, event_type FROM mechanic_rules WHERE boss_id = ?").bind(body.bossId).all<ExistingRuleRow>();
    const preview = buildCalibrationPreview({ payload, sourceUrl: parsed.sourceUrl, existingRules: existing.results });
    if (!preview.candidates.length) return Response.json({ error: "Wipefest returned the fight, but no reviewable encounter mechanics were found." }, { status: 422 });
    return Response.json({ preview });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Wipefest pull could not be read." }, { status: 500 });
  }
}
