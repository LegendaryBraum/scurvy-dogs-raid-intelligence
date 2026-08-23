import { ensureSchema, getRuntimeEnv } from "../../../db/runtime";
import { analyzeFightRules, type StoredRule } from "../../../lib/rule-analysis";
import { fetchReportOverview, fetchRuleEvents, groupRuleEventsByAbility } from "../../../lib/warcraft-logs";

export const runtime = "edge";

type PullRow = {
  id: string;
  report_id: string;
  fight_id: number;
  code: string;
};

type PullPlayerRow = {
  player_id: string;
  name: string;
  role: string;
};

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { bossId?: string };
    if (!payload.bossId) return Response.json({ error: "Choose a boss to recalculate." }, { status: 400 });

    const runtimeEnv = getRuntimeEnv();
    if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) {
      return Response.json({ error: "The Warcraft Logs connection is not available." }, { status: 503 });
    }

    const db = await ensureSchema();
    const [ruleResult, pullResult] = await Promise.all([
      db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1 ORDER BY updated_at").bind(payload.bossId).all<StoredRule>(),
      db.prepare("SELECT p.id, p.report_id, p.fight_id, r.code FROM pulls p JOIN reports r ON r.id = p.report_id WHERE p.boss_id = ? AND r.source_mode = 'live' ORDER BY r.start_time, p.fight_id").bind(payload.bossId).all<PullRow>(),
    ]);
    if (!ruleResult.results.length) return Response.json({ error: "Add at least one active rule before recalculating." }, { status: 409 });
    if (!pullResult.results.length) return Response.json({ error: "No stored Warcraft Logs pulls were found for this boss." }, { status: 404 });

    const credentials = { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };
    const pullsByReport = new Map<string, PullRow[]>();
    for (const pull of pullResult.results) {
      const reportPulls = pullsByReport.get(pull.code) ?? [];
      reportPulls.push(pull);
      pullsByReport.set(pull.code, reportPulls);
    }

    let events = 0;
    let playersPenalized = 0;
    let pulls = 0;
    for (const [code, storedPulls] of pullsByReport) {
      const { report, token } = await fetchReportOverview(code, credentials);
      const actors = report.masterData?.actors ?? [];
      const abilities = new Map((report.masterData?.abilities ?? []).map((ability) => [ability.gameID, ability.name]));
      const scoredRules = ruleResult.results
        .filter((rule) => parseJson<{ scoringMode?: string }>(rule.condition_json, {}).scoringMode !== "context")
      const scoredSpellIds = scoredRules.map((rule) => rule.spell_id);
      const reportRuleEvents = await fetchRuleEvents(code, storedPulls.map((pull) => pull.fight_id), scoredRules.map((rule) => ({ spellId: rule.spell_id, eventType: rule.event_type })), token);
      for (const storedPull of storedPulls) {
        const fight = report.fights.find((candidate) => candidate.id === storedPull.fight_id);
        if (!fight) continue;
        const playerResult = await db.prepare("SELECT pp.player_id, p.name, p.role FROM pull_players pp JOIN players p ON p.id = pp.player_id WHERE pp.pull_id = ?")
          .bind(storedPull.id).all<PullPlayerRow>();
        const playersByName = new Map(playerResult.results.map((player) => [player.name.toLowerCase(), player]));
        const participantIds = new Map<number, string>();
        const participantRoles = new Map<string, string>();
        for (const actorId of fight.friendlyPlayers ?? []) {
          const actor = actors.find((candidate) => candidate.id === actorId);
          const player = actor ? playersByName.get(actor.name.toLowerCase()) : undefined;
          if (!player) continue;
          participantIds.set(actorId, player.player_id);
          participantRoles.set(player.player_id, player.role);
        }
        const fightRuleEvents = reportRuleEvents.filter((raw) => {
          const timestamp = Number(raw && typeof raw === "object" ? (raw as Record<string, unknown>).timestamp : 0);
          return timestamp >= fight.startTime && timestamp <= fight.endTime;
        });
        const contextEvents = { deaths: [], interrupts: [], dispels: [] };
        const result = await analyzeFightRules({
          db,
          reportCode: code,
          fight,
          pullId: storedPull.id,
          token,
          rules: ruleResult.results,
          participantIds,
          participantRoles,
          abilities,
          contextEvents,
          eventPages: groupRuleEventsByAbility(fightRuleEvents, scoredSpellIds),
          resetExisting: true,
        });
        events += result.eventRows;
        playersPenalized += result.playersPenalized;
        pulls += 1;
      }
    }

    return Response.json({ recalculated: true, pulls, events, playersPenalized, rules: ruleResult.results.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved pulls could not be recalculated." }, { status: 500 });
  }
}
