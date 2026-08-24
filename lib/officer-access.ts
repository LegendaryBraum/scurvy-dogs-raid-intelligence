import { ensureSchema, makeId } from "../db/runtime";

export const officerCookieName = "sd_officer_session";

export type OfficerSession = {
  id: string;
  officerId: string;
  officerName: string;
  deviceLabel: string;
};

export function randomAccessToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashAccessToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function officerSessionCookie(token: string) {
  return `${officerCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export function clearOfficerSessionCookie() {
  return `${officerCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getOfficerSession(request: Request, touch = true): Promise<OfficerSession | null> {
  const token = cookieValue(request, officerCookieName);
  if (!token) return null;
  const tokenHash = await hashAccessToken(token);
  const db = await ensureSchema();
  const row = await db.prepare(`
    SELECT os.id, os.officer_id, os.device_label, o.name
    FROM officer_sessions os
    JOIN officers o ON o.id = os.officer_id
    WHERE os.token_hash = ? AND os.revoked_at IS NULL AND o.revoked_at IS NULL
  `).bind(tokenHash).first<{ id: string; officer_id: string; device_label: string; name: string }>();
  if (!row) return null;
  if (touch) await db.prepare("UPDATE officer_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  return { id: row.id, officerId: row.officer_id, officerName: row.name, deviceLabel: row.device_label };
}

export function officerRequiredResponse() {
  return Response.json({ error: "Open a valid officer access link to use this workspace." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export async function createOfficerSession(officerId: string, deviceLabel: string) {
  const token = randomAccessToken();
  const tokenHash = await hashAccessToken(token);
  const id = makeId("session");
  const db = await ensureSchema();
  await db.prepare("INSERT INTO officer_sessions (id, officer_id, device_label, token_hash) VALUES (?, ?, ?, ?)")
    .bind(id, officerId, deviceLabel, tokenHash).run();
  return { id, token };
}
