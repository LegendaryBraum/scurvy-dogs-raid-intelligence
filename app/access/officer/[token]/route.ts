import { ensureSchema } from "../../../../db/runtime";
import { createOfficerSession, hashAccessToken, officerSessionCookie } from "../../../../lib/officer-access";

export const runtime = "edge";

type InvitePreview = { officer_name: string; device_label: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const tokenHash = await hashAccessToken(token);
    const db = await ensureSchema();
    const invite = await db.prepare(`
      SELECT o.name AS officer_name, oi.device_label
      FROM officer_invites oi
      JOIN officers o ON o.id = oi.officer_id
      WHERE oi.token_hash = ? AND oi.consumed_at IS NULL AND oi.revoked_at IS NULL
        AND unixepoch(oi.expires_at) > unixepoch('now') AND o.revoked_at IS NULL
    `).bind(tokenHash).first<InvitePreview>();
    if (!invite) return Response.redirect(new URL("/access-invalid", request.url), 302);
    const action = escapeHtml(new URL(request.url).pathname);
    const officerName = escapeHtml(invite.officer_name);
    const deviceLabel = escapeHtml(invite.device_label);
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activate officer access · Scurvy Dogs</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#163746 0,#07151d 54%,#040b10 100%);color:#edf8f5;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.card{width:min(520px,100%);padding:36px;border:1px solid #31525c;border-radius:24px;background:rgba(9,27,35,.96);box-shadow:0 30px 80px #0008}.mark{display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:#c9ff50;color:#07100c;font-weight:900;letter-spacing:.04em}small{display:block;margin-top:22px;color:#8caeb5;text-transform:uppercase;letter-spacing:.14em}h1{margin:.35rem 0 .5rem;font-size:clamp(1.8rem,6vw,2.5rem);line-height:1.1}p{color:#b9ced2}.device{margin:24px 0;padding:15px 18px;border:1px solid #294954;border-radius:14px;background:#0d232c}.device strong,.device span{display:block}.device span{color:#8caeb5;font-size:.9rem}button{width:100%;padding:15px 18px;border:0;border-radius:14px;background:#c9ff50;color:#07100c;font:inherit;font-weight:800;cursor:pointer}em{display:block;margin-top:16px;color:#718f96;font-size:.82rem;font-style:normal;text-align:center}</style></head><body><main class="card"><div class="mark">SD</div><small>Private officer invitation</small><h1>Activate access for ${officerName}</h1><p>This confirmation keeps chat apps and link previews from using the one-time invitation before you arrive.</p><div class="device"><strong>${deviceLabel}</strong><span>This browser will appear by this name in Configure → Access.</span></div><form method="post" action="${action}"><button type="submit">Activate officer access</button></form><em>This invitation works once and expires after 24 hours.</em></main></body></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
    });
  } catch {
    return Response.redirect(new URL("/access-invalid", request.url), 302);
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const tokenHash = await hashAccessToken(token);
    const db = await ensureSchema();
    const invite = await db.prepare(`
      UPDATE officer_invites
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND unixepoch(expires_at) > unixepoch('now')
        AND officer_id IN (SELECT id FROM officers WHERE revoked_at IS NULL)
      RETURNING officer_id, device_label
    `).bind(tokenHash).first<{ officer_id: string; device_label: string }>();
    if (!invite) return Response.redirect(new URL("/access-invalid", request.url), 302);
    const session = await createOfficerSession(invite.officer_id, invite.device_label);
    return new Response(null, { status: 303, headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": officerSessionCookie(session.token), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return Response.redirect(new URL("/access-invalid", request.url), 302);
  }
}
