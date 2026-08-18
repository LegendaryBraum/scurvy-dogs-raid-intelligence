import { ensureSchema } from "../../../db/runtime";
import type { MechanicRule } from "../../../lib/types";

export const runtime = "edge";

export async function GET() {
  try {
    const db = await ensureSchema();
    const rows = await db.prepare("SELECT * FROM mechanic_rules WHERE enabled = 1 ORDER BY updated_at DESC").all<Record<string, unknown>>();
    return Response.json({ rules: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rules could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const rule = await request.json() as MechanicRule;
    if (!Number.isInteger(Number(rule.spellId)) || !rule.name?.trim() || !rule.bossId) {
      return Response.json({ error: "Boss, mechanic name, and a numeric Spell ID are required." }, { status: 400 });
    }
    const db = await ensureSchema();
    const seasonId = "season_demo";
    await db.batch([
      db.prepare("INSERT INTO seasons (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO NOTHING").bind(seasonId, "Demo configuration"),
      db.prepare("INSERT INTO bosses (id, season_id, encounter_id, raid_name, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
        .bind(rule.bossId, seasonId, 990001, "Demo raid tier", "The Gilded Tyrant"),
    ]);
    await db.prepare("INSERT INTO mechanic_rules (id, boss_id, spell_id, name, category, severity, weight, event_type, difficulties_json, roles_json, condition_json, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET spell_id = excluded.spell_id, name = excluded.name, category = excluded.category, severity = excluded.severity, weight = excluded.weight, event_type = excluded.event_type, difficulties_json = excluded.difficulties_json, roles_json = excluded.roles_json, condition_json = excluded.condition_json, enabled = 1, updated_at = CURRENT_TIMESTAMP")
      .bind(rule.id, rule.bossId, Number(rule.spellId), rule.name.trim(), rule.category, rule.severity, Number(rule.weight), rule.eventType, JSON.stringify(rule.difficulties), JSON.stringify(rule.roles), JSON.stringify(rule.condition)).run();
    return Response.json({ rule, saved: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rule could not be saved." }, { status: 500 });
  }
}
