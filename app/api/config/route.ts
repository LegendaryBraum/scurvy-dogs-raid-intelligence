import { ensureSchema } from "../../../db/runtime";
import type { MechanicRule } from "../../../lib/types";
import { raidData } from "../../../lib/raid-data";

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
    const existingBoss = await db.prepare("SELECT id FROM bosses WHERE id = ?").bind(rule.bossId).first<{ id: string }>();
    if (!existingBoss) {
      const staticBoss = raidData.bosses.find((boss) => boss.id === rule.bossId);
      if (!staticBoss) return Response.json({ error: "Import this boss before adding its first rule." }, { status: 409 });
      const seasonId = "season_verified_snapshot";
      await db.batch([
        db.prepare("INSERT INTO seasons (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO NOTHING").bind(seasonId, raidData.season),
        db.prepare("INSERT INTO bosses (id, season_id, encounter_id, raid_name, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
          .bind(rule.bossId, seasonId, Number(rule.bossId.match(/\d+/)?.[0] ?? 0), raidData.raid, staticBoss.name),
      ]);
    }
    await db.prepare("INSERT INTO mechanic_rules (id, boss_id, spell_id, name, category, severity, weight, event_type, difficulties_json, roles_json, condition_json, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET spell_id = excluded.spell_id, name = excluded.name, category = excluded.category, severity = excluded.severity, weight = excluded.weight, event_type = excluded.event_type, difficulties_json = excluded.difficulties_json, roles_json = excluded.roles_json, condition_json = excluded.condition_json, enabled = 1, updated_at = CURRENT_TIMESTAMP")
      .bind(rule.id, rule.bossId, Number(rule.spellId), rule.name.trim(), rule.category, rule.severity, Number(rule.weight), rule.eventType, JSON.stringify(rule.difficulties), JSON.stringify(rule.roles), JSON.stringify(rule.condition)).run();
    return Response.json({ rule, saved: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rule could not be saved." }, { status: 500 });
  }
}
