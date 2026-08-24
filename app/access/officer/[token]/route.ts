import { ensureSchema } from "../../../../db/runtime";
import { createOfficerSession, hashAccessToken, officerSessionCookie } from "../../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const tokenHash = await hashAccessToken(token);
    const db = await ensureSchema();
    const invite = await db.prepare(`
      UPDATE officer_invites
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        AND officer_id IN (SELECT id FROM officers WHERE revoked_at IS NULL)
      RETURNING officer_id, device_label
    `).bind(tokenHash).first<{ officer_id: string; device_label: string }>();
    if (!invite) return Response.redirect(new URL("/access-invalid", request.url), 302);
    const session = await createOfficerSession(invite.officer_id, invite.device_label);
    return new Response(null, { status: 302, headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": officerSessionCookie(session.token), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return Response.redirect(new URL("/access-invalid", request.url), 302);
  }
}
