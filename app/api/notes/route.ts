import { ensureSchema, makeId } from "../../../db/runtime";
import { loadOfficerNotes, resolveRaiderIdentity } from "../../../lib/officer-notes";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type NoteScope = "player" | "raid_night" | "boss" | "pull";
type NotePayload = {
  id?: string;
  playerId?: string;
  visibility?: "player" | "officer";
  scope?: NoteScope;
  body?: string;
  raidNightId?: string;
  bossId?: string;
  pullId?: string;
};

async function validatedContext(db: D1Database, payload: NotePayload) {
  const scope = payload.scope ?? "pull";
  if (scope === "player") return { raidNightId: null, bossId: null, pullId: null };
  if (scope === "pull") {
    if (!payload.pullId) throw new Error("Choose a pull for this note.");
    const row = await db.prepare(`
      SELECT pu.id, pu.boss_id, r.raid_night_id
      FROM pulls pu
      JOIN reports r ON r.id = pu.report_id
      WHERE pu.id = ? AND pu.included = 1 AND r.included = 1 AND r.source_mode = 'live'
    `).bind(payload.pullId).first<{ id: string; boss_id: string; raid_night_id: string }>();
    if (!row) throw new Error("That pull is no longer available.");
    return { raidNightId: row.raid_night_id, bossId: row.boss_id, pullId: row.id };
  }
  if (!payload.raidNightId) throw new Error("Choose a raid night for this note.");
  const night = await db.prepare("SELECT id FROM raid_nights WHERE id = ? AND included = 1").bind(payload.raidNightId).first<{ id: string }>();
  if (!night) throw new Error("That raid night is no longer available.");
  if (scope === "raid_night") return { raidNightId: night.id, bossId: null, pullId: null };
  if (!payload.bossId) throw new Error("Choose a boss for this note.");
  const boss = await db.prepare(`
    SELECT b.id
    FROM bosses b
    JOIN pulls pu ON pu.boss_id = b.id AND pu.included = 1
    JOIN reports r ON r.id = pu.report_id AND r.included = 1 AND r.source_mode = 'live'
    WHERE b.id = ? AND r.raid_night_id = ?
    LIMIT 1
  `).bind(payload.bossId, night.id).first<{ id: string }>();
  if (!boss) throw new Error("That boss is not available on the selected raid night.");
  return { raidNightId: night.id, bossId: boss.id, pullId: null };
}

function noteBody(payload: NotePayload) {
  const body = payload.body?.trim() ?? "";
  if (!body) throw new Error("Write the coaching note before saving it.");
  if (body.length > 1500) throw new Error("Keep coaching notes to 1,500 characters or fewer.");
  return body;
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const playerId = new URL(request.url).searchParams.get("playerId");
    if (!playerId) return Response.json({ error: "Choose a player to review notes." }, { status: 400 });
    const db = await ensureSchema();
    return Response.json({ notes: await loadOfficerNotes(db, playerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Coaching notes could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getOfficerSession(request);
    if (!session) return officerRequiredResponse();
    const payload = await request.json() as NotePayload;
    if (!payload.playerId) return Response.json({ error: "Choose a player for this note." }, { status: 400 });
    const db = await ensureSchema();
    const identityId = await resolveRaiderIdentity(db, payload.playerId);
    if (!identityId) return Response.json({ error: "That player is no longer available." }, { status: 404 });
    const context = await validatedContext(db, payload);
    const visibility = payload.visibility === "officer" ? "officer" : "player";
    await db.prepare(`
      INSERT INTO officer_notes (id, player_id, author_officer_id, raid_night_id, boss_id, pull_id, visibility, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(makeId("note"), identityId, session.officerId, context.raidNightId, context.bossId, context.pullId, visibility, noteBody(payload)).run();
    return Response.json({ saved: true, notes: await loadOfficerNotes(db, payload.playerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The coaching note could not be saved.";
    return Response.json({ error: message }, { status: /Choose|Keep|Write|available/.test(message) ? 400 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as NotePayload;
    if (!payload.id || !payload.playerId) return Response.json({ error: "Choose a coaching note to edit." }, { status: 400 });
    const db = await ensureSchema();
    const identityId = await resolveRaiderIdentity(db, payload.playerId);
    if (!identityId) return Response.json({ error: "That player is no longer available." }, { status: 404 });
    const context = await validatedContext(db, payload);
    const visibility = payload.visibility === "officer" ? "officer" : "player";
    const result = await db.prepare(`
      UPDATE officer_notes
      SET raid_night_id = ?, boss_id = ?, pull_id = ?, visibility = ?, body = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND player_id = ?
    `).bind(context.raidNightId, context.bossId, context.pullId, visibility, noteBody(payload), payload.id, identityId).run();
    if (!result.meta.changes) return Response.json({ error: "That coaching note no longer exists." }, { status: 404 });
    return Response.json({ saved: true, notes: await loadOfficerNotes(db, payload.playerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The coaching note could not be updated.";
    return Response.json({ error: message }, { status: /Choose|Keep|Write|available/.test(message) ? 400 : 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as Pick<NotePayload, "id" | "playerId">;
    if (!payload.id || !payload.playerId) return Response.json({ error: "Choose a coaching note to remove." }, { status: 400 });
    const db = await ensureSchema();
    const identityId = await resolveRaiderIdentity(db, payload.playerId);
    if (!identityId) return Response.json({ error: "That player is no longer available." }, { status: 404 });
    await db.prepare("DELETE FROM officer_notes WHERE id = ? AND player_id = ?").bind(payload.id, identityId).run();
    return Response.json({ deleted: true, notes: await loadOfficerNotes(db, payload.playerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The coaching note could not be removed." }, { status: 500 });
  }
}
