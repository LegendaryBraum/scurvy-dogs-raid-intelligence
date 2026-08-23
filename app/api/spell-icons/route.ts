import { ensureSchema, getRuntimeEnv } from "../../../db/runtime";
import { fetchReportOverview } from "../../../lib/warcraft-logs";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { reportCode?: string; spellIds?: number[] };
    const spellIds = [...new Set((payload.spellIds ?? []).map(Number).filter((spellId) => Number.isInteger(spellId) && spellId > 0))].slice(0, 250);
    if (!payload.reportCode || !spellIds.length) {
      return Response.json({ error: "A report and at least one valid Spell ID are required." }, { status: 400 });
    }

    const runtimeEnv = getRuntimeEnv();
    if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) {
      return Response.json({ error: "The Warcraft Logs connection is not available." }, { status: 503 });
    }

    const { report } = await fetchReportOverview(payload.reportCode, {
      clientId: runtimeEnv.WCL_CLIENT_ID,
      clientSecret: runtimeEnv.WCL_CLIENT_SECRET,
    });
    const requested = new Set(spellIds);
    const icons = Object.fromEntries((report.masterData?.abilities ?? [])
      .filter((ability): ability is typeof ability & { icon: string } => requested.has(ability.gameID) && Boolean(ability.icon))
      .map((ability) => [String(ability.gameID), ability.icon]));

    const db = await ensureSchema();
    const updates = Object.entries(icons).map(([spellId, icon]) => db.prepare("UPDATE mechanic_rules SET icon = ? WHERE spell_id = ?").bind(icon, Number(spellId)));
    if (updates.length) await db.batch(updates);

    return Response.json({ icons, found: updates.length, requested: spellIds.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Spell artwork could not be loaded." }, { status: 500 });
  }
}
