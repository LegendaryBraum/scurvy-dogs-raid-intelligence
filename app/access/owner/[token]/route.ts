import { ensureSchema, getRuntimeEnv, makeId } from "../../../../db/runtime";
import { createOfficerSession, hashAccessToken, officerSessionCookie } from "../../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const configured = getRuntimeEnv().OFFICER_BOOTSTRAP_KEY;
    if (!configured || await hashAccessToken(token) !== await hashAccessToken(configured)) return Response.redirect(new URL("/access-invalid", request.url), 302);
    const bootstrapHash = await hashAccessToken(configured);
    const db = await ensureSchema();
    const consumed = await db.prepare("SELECT value FROM access_settings WHERE key = 'owner_bootstrap_hash'").first<{ value: string }>();
    if (consumed?.value === bootstrapHash) return Response.redirect(new URL("/access-invalid", request.url), 302);
    let officer = await db.prepare("SELECT id FROM officers WHERE lower(name) = lower('Jordan') AND revoked_at IS NULL ORDER BY created_at LIMIT 1").first<{ id: string }>();
    if (!officer) {
      officer = { id: makeId("officer") };
      await db.prepare("INSERT INTO officers (id, name) VALUES (?, 'Jordan')").bind(officer.id).run();
    }
    const deviceLabel = new URL(request.url).searchParams.get("device")?.trim().slice(0, 80) || "Primary browser";
    const session = await createOfficerSession(officer.id, deviceLabel);
    await db.prepare("INSERT INTO access_settings (key, value) VALUES ('owner_bootstrap_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(bootstrapHash).run();
    return new Response(null, { status: 302, headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": officerSessionCookie(session.token), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return Response.redirect(new URL("/access-invalid", request.url), 302);
  }
}
