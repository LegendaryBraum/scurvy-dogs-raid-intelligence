import { ensureSchema, makeId } from "../../../../db/runtime";
import { getOfficerSession, hashAccessToken, officerRequiredResponse, randomAccessToken, type OfficerSession } from "../../../../lib/officer-access";
import type { AccessWorkspace, OfficerAccessRecord } from "../../../../lib/types";

export const runtime = "edge";

type OfficerRow = { id: string; name: string };
type SessionRow = { id: string; officer_id: string; device_label: string; created_at: string; last_used_at: string };
type InviteRow = { id: string; officer_id: string; device_label: string; created_at: string; expires_at: string };
type PlayerLinkRow = { token: string; player_id: string; player_name: string; created_at: string; last_used_at: string | null };

async function readWorkspace(request: Request, session: OfficerSession): Promise<AccessWorkspace> {
  const db = await ensureSchema();
  const [officerResult, sessionResult, inviteResult, playerResult] = await Promise.all([
    db.prepare("SELECT id, name FROM officers WHERE revoked_at IS NULL ORDER BY lower(name)").all<OfficerRow>(),
    db.prepare("SELECT id, officer_id, device_label, created_at, last_used_at FROM officer_sessions WHERE revoked_at IS NULL ORDER BY last_used_at DESC").all<SessionRow>(),
    db.prepare("SELECT id, officer_id, device_label, created_at, expires_at FROM officer_invites WHERE consumed_at IS NULL AND revoked_at IS NULL AND unixepoch(expires_at) > unixepoch('now') ORDER BY created_at DESC").all<InviteRow>(),
    db.prepare(`
      SELECT pal.token, pal.player_id, p.name AS player_name, pal.created_at, pal.last_used_at
      FROM player_access_links pal
      JOIN players p ON p.id = pal.player_id
      LEFT JOIN player_roster_settings prs ON prs.player_id = p.id
      WHERE pal.revoked_at IS NULL AND COALESCE(prs.included, 1) = 1
      ORDER BY lower(p.name)
    `).all<PlayerLinkRow>(),
  ]);
  const officers: OfficerAccessRecord[] = officerResult.results.map((officer) => ({
    id: officer.id,
    name: officer.name,
    sessions: sessionResult.results.filter((candidate) => candidate.officer_id === officer.id).map((candidate) => ({ id: candidate.id, deviceLabel: candidate.device_label, createdAt: candidate.created_at, lastUsedAt: candidate.last_used_at, current: candidate.id === session.id })),
    invites: inviteResult.results.filter((candidate) => candidate.officer_id === officer.id).map((candidate) => ({ id: candidate.id, deviceLabel: candidate.device_label, createdAt: candidate.created_at, expiresAt: candidate.expires_at })),
  }));
  return {
    currentSessionId: session.id,
    currentOfficerName: session.officerName,
    officers,
    players: playerResult.results.map((row) => ({ token: row.token, playerId: row.player_id, playerName: row.player_name, createdAt: row.created_at, lastUsedAt: row.last_used_at, url: new URL(`/share/${row.token}`, request.url).toString() })),
  };
}

export async function GET(request: Request) {
  try {
    const session = await getOfficerSession(request);
    if (!session) return officerRequiredResponse();
    return Response.json({ access: await readWorkspace(request, session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Access records could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getOfficerSession(request);
    if (!session) return officerRequiredResponse();
    const payload = await request.json() as { kind?: "officer" | "player"; name?: string; deviceLabel?: string; playerId?: string };
    const db = await ensureSchema();
    if (payload.kind === "officer") {
      const name = payload.name?.trim().slice(0, 60);
      const deviceLabel = payload.deviceLabel?.trim().slice(0, 80) || "Primary browser";
      if (!name) return Response.json({ error: "Name the officer before creating their link." }, { status: 400 });
      let officer = await db.prepare("SELECT id FROM officers WHERE lower(name) = lower(?) AND revoked_at IS NULL ORDER BY created_at LIMIT 1").bind(name).first<{ id: string }>();
      if (!officer) {
        officer = { id: makeId("officer") };
        await db.prepare("INSERT INTO officers (id, name) VALUES (?, ?)").bind(officer.id, name).run();
      }
      await db.prepare("UPDATE officer_invites SET revoked_at = CURRENT_TIMESTAMP WHERE officer_id = ? AND lower(device_label) = lower(?) AND consumed_at IS NULL AND revoked_at IS NULL").bind(officer.id, deviceLabel).run();
      const token = randomAccessToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.prepare("INSERT INTO officer_invites (id, officer_id, device_label, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(makeId("invite"), officer.id, deviceLabel, await hashAccessToken(token), expiresAt).run();
      return Response.json({ url: new URL(`/access/officer/${token}`, request.url).toString(), expiresAt, access: await readWorkspace(request, session) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (payload.kind === "player") {
      if (!payload.playerId) return Response.json({ error: "Choose a player before creating their link." }, { status: 400 });
      const player = await db.prepare("SELECT p.id FROM players p LEFT JOIN player_roster_settings prs ON prs.player_id = p.id WHERE p.id = ? AND COALESCE(prs.included, 1) = 1").bind(payload.playerId).first<{ id: string }>();
      if (!player) return Response.json({ error: "That player is not active in the raid roster." }, { status: 404 });
      let link = await db.prepare("SELECT token FROM player_access_links WHERE player_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(player.id).first<{ token: string }>();
      if (!link) {
        link = { token: randomAccessToken() };
        await db.prepare("INSERT INTO player_access_links (token, player_id) VALUES (?, ?)").bind(link.token, player.id).run();
      }
      return Response.json({ url: new URL(`/share/${link.token}`, request.url).toString(), access: await readWorkspace(request, session) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Choose player or officer access." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The access link could not be created." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getOfficerSession(request);
    if (!session) return officerRequiredResponse();
    const payload = await request.json() as { kind?: "player" | "session" | "invite" | "officer" | "all_other_officers"; id?: string };
    const db = await ensureSchema();
    if (payload.kind === "player" && payload.id) await db.prepare("UPDATE player_access_links SET revoked_at = CURRENT_TIMESTAMP WHERE token = ?").bind(payload.id).run();
    else if (payload.kind === "session" && payload.id) {
      if (payload.id === session.id) return Response.json({ error: "Use Sign out this device from the header instead of revoking your current session here." }, { status: 409 });
      await db.prepare("UPDATE officer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.id).run();
    } else if (payload.kind === "invite" && payload.id) await db.prepare("UPDATE officer_invites SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.id).run();
    else if (payload.kind === "officer" && payload.id) {
      if (payload.id === session.officerId) return Response.json({ error: "Your own officer identity cannot be revoked while you are using it." }, { status: 409 });
      await db.batch([
        db.prepare("UPDATE officers SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.id),
        db.prepare("UPDATE officer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE officer_id = ?").bind(payload.id),
        db.prepare("UPDATE officer_invites SET revoked_at = CURRENT_TIMESTAMP WHERE officer_id = ?").bind(payload.id),
      ]);
    } else if (payload.kind === "all_other_officers") {
      await db.batch([
        db.prepare("UPDATE officer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id != ? AND revoked_at IS NULL").bind(session.id),
        db.prepare("UPDATE officer_invites SET revoked_at = CURRENT_TIMESTAMP WHERE consumed_at IS NULL AND revoked_at IS NULL"),
      ]);
    } else return Response.json({ error: "Choose an access record to revoke." }, { status: 400 });
    return Response.json({ revoked: true, access: await readWorkspace(request, session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Access could not be revoked." }, { status: 500 });
  }
}
