import { loadPlayerHistory } from "../../../lib/player-history";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");
    const difficulty = url.searchParams.get("difficulty");
    if (!playerId) return Response.json({ error: "Choose a player to view history." }, { status: 400 });
    const result = await loadPlayerHistory(playerId, null, difficulty);
    if (!result) return Response.json({ error: "That player is no longer available." }, { status: 404 });
    return Response.json({ history: result.history, linkedCharacters: result.linkedCharacters, difficulty: difficulty ?? "All difficulties" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Player history could not be loaded." }, { status: 500 });
  }
}
