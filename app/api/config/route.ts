import { ensureSchema } from "../../../db/runtime";
import type { MechanicRule } from "../../../lib/types";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    const rows = await db.prepare("SELECT * FROM mechanic_rules ORDER BY enabled DESC, updated_at DESC").all<Record<string, unknown>>();
    return Response.json({ rules: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rules could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const rule = await request.json() as MechanicRule;
    if (!Number.isInteger(Number(rule.spellId)) || !rule.name?.trim() || !rule.bossId) {
      return Response.json({ error: "Boss, mechanic name, and a numeric Spell ID are required." }, { status: 400 });
    }
    const db = await ensureSchema();
    const existingBoss = await db.prepare("SELECT id FROM bosses WHERE id = ?").bind(rule.bossId).first<{ id: string }>();
    if (!existingBoss) return Response.json({ error: "Import this boss before adding its first rule." }, { status: 409 });
    const updatedAt = new Date().toISOString();
    await db.prepare("INSERT INTO mechanic_rules (id, boss_id, spell_id, name, icon, category, severity, weight, event_type, difficulties_json, roles_json, condition_json, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET spell_id = excluded.spell_id, name = excluded.name, icon = excluded.icon, category = excluded.category, severity = excluded.severity, weight = excluded.weight, event_type = excluded.event_type, difficulties_json = excluded.difficulties_json, roles_json = excluded.roles_json, condition_json = excluded.condition_json, enabled = excluded.enabled, updated_at = excluded.updated_at")
      .bind(rule.id, rule.bossId, Number(rule.spellId), rule.name.trim(), rule.icon ?? null, rule.category, rule.severity, Number(rule.weight), rule.eventType, JSON.stringify(rule.difficulties), JSON.stringify(rule.roles), JSON.stringify(rule.condition), rule.enabled === false ? 0 : 1, updatedAt).run();
    return Response.json({ rule: { ...rule, enabled: rule.enabled !== false }, saved: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rule could not be saved." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { id?: string; enabled?: boolean };
    if (!payload.id || typeof payload.enabled !== "boolean") {
      return Response.json({ error: "Choose a rule and active or paused state." }, { status: 400 });
    }
    const db = await ensureSchema();
    const result = await db.prepare("UPDATE mechanic_rules SET enabled = ?, updated_at = ? WHERE id = ?")
      .bind(payload.enabled ? 1 : 0, new Date().toISOString(), payload.id).run();
    if (!result.meta.changes) return Response.json({ error: "That rule no longer exists." }, { status: 404 });
    return Response.json({ id: payload.id, enabled: payload.enabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rule state could not be changed." }, { status: 500 });
  }
}
