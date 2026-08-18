import { demoData } from "../../../lib/demo-data";
import { fetchFightEvents, fetchReportOverview, parseReportUrls, type WclReportOverview } from "../../../lib/warcraft-logs";
import { ensureSchema, getRuntimeEnv, makeId } from "../../../db/runtime";

export const runtime = "edge";

function roleFromSpec(spec: string) {
  if (["Restoration", "Holy", "Discipline", "Mistweaver", "Preservation"].includes(spec)) return "Healer";
  if (["Protection", "Blood", "Brewmaster", "Guardian", "Vengeance"].includes(spec)) return "Tank";
  return "DPS";
}

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return `${prefix}_${Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function demoOverview(code: string): WclReportOverview {
  return {
    code, title: "Scurvy Dogs · Demo import", startTime: Date.now() - 2 * 60 * 60 * 1000, endTime: Date.now(), visibility: "public",
    zone: { name: demoData.raid },
    fights: demoData.pulls.map((pull, index) => ({
      id: index + 1, name: demoData.bosses.find((boss) => boss.id === pull.bossId)?.name ?? "Encounter",
      encounterID: 990001 + demoData.bosses.findIndex((boss) => boss.id === pull.bossId), startTime: index * 430000,
      endTime: index * 430000 + Number(pull.duration.split(":")[0]) * 60000 + Number(pull.duration.split(":")[1]) * 1000,
      difficulty: 4, kill: pull.killed, bossPercentage: pull.killed ? 0 : 420, averageItemLevel: 710,
      friendlyPlayers: demoData.players.map((_, playerIndex) => playerIndex + 1), friendlySpecs: demoData.players.map((player) => player.spec),
    })),
    masterData: { actors: demoData.players.map((player, index) => ({ id: index + 1, name: player.name, type: "Player", subType: player.className, server: player.realm })) },
    rankings: null,
  };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { urls?: string[] | string; season?: string; raidNight?: string };
    const parsed = parseReportUrls(payload.urls ?? []);
    if (!parsed.reports.length) return Response.json({ error: "Add at least one valid Warcraft Logs report URL.", invalid: parsed.invalid }, { status: 400 });

    const db = await ensureSchema();
    const runtimeEnv = getRuntimeEnv();
    const hasCredentials = Boolean(runtimeEnv.WCL_CLIENT_ID && runtimeEnv.WCL_CLIENT_SECRET);
    const seasonId = await stableId("season", payload.season ?? demoData.season);
    const raidNightId = makeId("night");
    const now = new Date();
    const results: Array<Record<string, unknown>> = [];

    await db.batch([
      db.prepare("INSERT INTO seasons (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1").bind(seasonId, payload.season ?? demoData.season),
      db.prepare("INSERT INTO raid_nights (id, season_id, name, happened_at) VALUES (?, ?, ?, ?)").bind(raidNightId, seasonId, payload.raidNight ?? `Imported raid · ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, now.toISOString()),
    ]);

    for (const requested of parsed.reports) {
      const existing = await db.prepare("SELECT id FROM reports WHERE code = ?").bind(requested.code).first<{ id: string }>();
      if (existing) { results.push({ code: requested.code, status: "already_imported" }); continue; }

      let overview: WclReportOverview;
      let accessToken: string | null = null;
      let sourceMode = "demo";
      if (hasCredentials) {
        const live = await fetchReportOverview(requested.code, { clientId: runtimeEnv.WCL_CLIENT_ID!, clientSecret: runtimeEnv.WCL_CLIENT_SECRET! });
        overview = live.report; accessToken = live.token; sourceMode = "live";
      } else {
        overview = demoOverview(requested.code);
      }

      const reportId = makeId("report");
      await db.prepare("INSERT INTO reports (id, raid_night_id, code, url, title, zone_name, start_time, end_time, source_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(reportId, raidNightId, requested.code, requested.url, overview.title, overview.zone?.name ?? "Unknown raid", overview.startTime, overview.endTime, sourceMode).run();

      const actors = overview.masterData?.actors ?? [];
      let pullCount = 0;
      let playerRows = 0;
      let eventRows = 0;
      for (const [fightIndex, fight] of overview.fights.filter((candidate) => candidate.encounterID > 0).entries()) {
        const bossId = `${seasonId}_encounter_${fight.encounterID}`;
        const pullId = `${reportId}_fight_${fight.id}`;
        await db.batch([
          db.prepare("INSERT INTO bosses (id, season_id, encounter_id, raid_name, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season_id, encounter_id) DO UPDATE SET raid_name = excluded.raid_name, name = excluded.name")
            .bind(bossId, seasonId, fight.encounterID, overview.zone?.name ?? "Unknown raid", fight.name),
          db.prepare("INSERT INTO pulls (id, report_id, boss_id, fight_id, pull_number, difficulty, killed, start_time, end_time, boss_percentage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(pullId, reportId, bossId, fight.id, fightIndex + 1, fight.difficulty ?? null, fight.kill ? 1 : 0, fight.startTime, fight.endTime, fight.bossPercentage ?? null),
        ]);
        pullCount += 1;

        for (const [participantIndex, actorId] of (fight.friendlyPlayers ?? []).entries()) {
          const actor = actors.find((candidate) => candidate.id === actorId);
          if (!actor) continue;
          const realm = actor.server ?? "";
          const playerId = await stableId("player", `${actor.name}|${realm}`);
          const spec = fight.friendlySpecs?.[participantIndex] ?? "Unknown";
          const seed = actor.name.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
          const parse = 65 + (seed % 31);
          const ilvlParse = Math.min(99, parse + 4);
          await db.batch([
            db.prepare("INSERT INTO players (id, name, realm, class_name, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, realm) DO UPDATE SET class_name = excluded.class_name, role = excluded.role")
              .bind(playerId, actor.name, realm, actor.subType, roleFromSpec(spec)),
            db.prepare("INSERT INTO pull_players (id, pull_id, player_id, spec, parse, ilvl_parse, mechanics_score, performance_score, attendance_score, preparation_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pull_id, player_id) DO NOTHING")
              .bind(`${pullId}_${playerId}`, pullId, playerId, spec, parse, ilvlParse, 100, Math.round(parse * .65 + ilvlParse * .35), 100, 100),
          ]);
          playerRows += 1;
        }

        if (sourceMode === "demo" && fightIndex === 0) {
          for (const demoEvent of demoData.events) {
            const demoPlayer = demoData.players.find((player) => player.id === demoEvent.playerId);
            if (!demoPlayer) continue;
            const playerId = await stableId("player", `${demoPlayer.name}|${demoPlayer.realm}`);
            await db.prepare("INSERT INTO events (id, pull_id, player_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(makeId("event"), pullId, playerId, demoEvent.spellId, demoEvent.kind, fight.startTime, demoEvent.amount ?? null, demoEvent.kind, JSON.stringify({ ability: demoEvent.ability, detail: demoEvent.detail })).run();
            eventRows += 1;
          }
        }

        if (sourceMode === "live" && accessToken) {
          const configuredRules = await db.prepare("SELECT id, spell_id FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(bossId).all<{ id: string; spell_id: number }>();
          for (const rule of configuredRules.results) {
            const liveEvents = await fetchFightEvents(requested.code, fight.id, rule.spell_id, accessToken);
            for (const rawEvent of liveEvents) {
              const event = rawEvent as Record<string, unknown>;
              const actorId = Number(event.targetID ?? event.sourceID ?? 0);
              const actor = actors.find((candidate) => candidate.id === actorId);
              const playerId = actor ? await stableId("player", `${actor.name}|${actor.server ?? ""}`) : null;
              await db.prepare("INSERT INTO events (id, pull_id, player_id, rule_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(makeId("event"), pullId, playerId, rule.id, rule.spell_id, String(event.type ?? "observed"), Number(event.timestamp ?? fight.startTime), Number(event.amount ?? 0) || null, "observed", JSON.stringify(event)).run();
              eventRows += 1;
            }
          }
        }
      }
      results.push({ code: requested.code, status: "imported", sourceMode, pulls: pullCount, playerRows, relevantEvents: eventRows });
    }

    return Response.json({ reports: results, invalid: parsed.invalid, hierarchy: "Season → Raid Night → Report → Boss → Pull → Player", liveApiConfigured: hasCredentials });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The reports could not be imported." }, { status: 500 });
  }
}
