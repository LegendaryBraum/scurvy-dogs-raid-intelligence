import { loadPrivatePlayerWorkspace } from "../../../../lib/player-access-data";

export const runtime = "edge";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const raidNightId = new URL(request.url).searchParams.get("raidNightId");
    const workspace = await loadPrivatePlayerWorkspace(token, raidNightId);
    if (!workspace) return Response.json({ error: "This player link is unavailable or has been revoked." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ workspace }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The private player dashboard could not be loaded." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
