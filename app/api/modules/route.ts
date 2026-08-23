import { ensureSchema } from "../../../db/runtime";
import type { ModuleSettings, ScoreKey } from "../../../lib/types";

export const runtime = "edge";

const defaults: ModuleSettings = { mechanics: true, performance: true, attendance: false, preparation: false };
const moduleKeys = Object.keys(defaults) as ScoreKey[];

export async function GET() {
  try {
    const db = await ensureSchema();
    const rows = await db.prepare("SELECT module_key, enabled FROM score_module_settings").all<{ module_key: string; enabled: number }>();
    const settings = { ...defaults };
    for (const row of rows.results) {
      if (moduleKeys.includes(row.module_key as ScoreKey)) settings[row.module_key as ScoreKey] = Boolean(row.enabled);
    }
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Score modules could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { key?: ScoreKey; enabled?: boolean };
    if (!payload.key || !moduleKeys.includes(payload.key) || typeof payload.enabled !== "boolean") {
      return Response.json({ error: "Choose a valid score module and active or paused state." }, { status: 400 });
    }
    const db = await ensureSchema();
    await db.prepare(`
      INSERT INTO score_module_settings (module_key, enabled, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP
    `).bind(payload.key, payload.enabled ? 1 : 0).run();
    return Response.json({ key: payload.key, enabled: payload.enabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The score module could not be updated." }, { status: 500 });
  }
}
