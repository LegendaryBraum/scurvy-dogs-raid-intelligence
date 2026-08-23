import { ensureSchema, getRuntimeEnv, makeId } from "../../../db/runtime";
import {
  fetchFightContextEvents,
  fetchFightEvents,
  fetchReportOverview,
  fetchReportPreview,
  parseRankingRows,
  parseReportUrls,
} from "../../../lib/warcraft-logs";

export const runtime = "edge";

type ImportPayload = {
  urls?: string[] | string;
  season?: string;
  raidNight?: string;
  action?: "preview" | "import";
  selections?: Array<{ code: string; fightIds: number[] }>;
};

type StoredRule = {
  id: string;
  spell_id: number;
  name: string;
  category: string;
  severity: string;
  weight: number;
  event_type: string;
  difficulties_json: string;
  roles_json: string;
  condition_json: string;
};

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

function roleFromSpec(spec: string) {
  if (["Restoration", "Holy", "Discipline", "Mistweaver", "Preservation"].includes(spec)) return "Healer";
  if (["Protection", "Blood", "Brewmaster", "Guardian", "Vengeance"].includes(spec)) return "Tank";
  return "DPS";
}

function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return `${prefix}_${Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function record(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

function eventSpellId(value: unknown) {
  const event = record(value);
  return number(event.abilityGameID ?? event.abilityID ?? record(event.ability).gameID ?? record(event.ability).id);
}

function eventActorId(value: unknown, preferSource = false) {
  const event = record(value);
  return number(preferSource ? (event.sourceID ?? event.targetID) : (event.targetID ?? event.sourceID));
}

function eventTimestamp(value: unknown, fallback: number) {
  return number(record(value).timestamp) || fallback;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function removeDemoReport(db: D1Database, reportId: string) {
  await db.batch([
    db.prepare("DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM events WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pull_players WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pulls WHERE report_id = ?").bind(reportId),
    db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId),
  ]);
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as ImportPayload;
    const parsed = parseReportUrls(payload.urls ?? []);
    if (!parsed.reports.length) {
      return Response.json({ error: "Add at least one valid Warcraft Logs report URL.", invalid: parsed.invalid }, { status: 400 });
    }

    const runtimeEnv = getRuntimeEnv();
    if (!runtimeEnv.WCL_CLIENT_ID || !runtimeEnv.WCL_CLIENT_SECRET) {
      return Response.json({
        error: "The one-time Warcraft Logs connection has not been completed yet.",
        needsConnection: true,
      }, { status: 503 });
    }
    const credentials = { clientId: runtimeEnv.WCL_CLIENT_ID, clientSecret: runtimeEnv.WCL_CLIENT_SECRET };

    if ((payload.action ?? "preview") === "preview") {
      const reports = await Promise.all(parsed.reports.map((report) => fetchReportPreview(report.code, credentials)));
      return Response.json({ reports, invalid: parsed.invalid, readyToImport: true });
    }

    const selectionByCode = new Map((payload.selections ?? []).map((selection) => [selection.code, new Set(selection.fightIds.filter(Number.isInteger))]));
    if (!selectionByCode.size) {
      return Response.json({ error: "Review the report and select at least one pull before importing." }, { status: 400 });
    }

    const db = await ensureSchema();
    const seasonName = payload.season?.trim() || "Current season";
    const seasonId = await stableId("season", seasonName);
    const results: Array<Record<string, unknown>> = [];
    let raidNightId: string | null = null;

    await db.prepare("INSERT INTO seasons (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1")
      .bind(seasonId, seasonName).run();

    for (const requested of parsed.reports) {
      const selectedFightIds = selectionByCode.get(requested.code) ?? new Set<number>();
      if (!selectedFightIds.size) {
        results.push({ code: requested.code, status: "skipped", pulls: 0, bosses: 0 });
        continue;
      }
      const existing = await db.prepare("SELECT id, source_mode FROM reports WHERE code = ?").bind(requested.code).first<{ id: string; source_mode: string }>();
      if (existing?.source_mode === "live") {
        results.push({ code: requested.code, status: "already_imported", sourceMode: "live" });
        continue;
      }
      if (existing) await removeDemoReport(db, existing.id);

      const { report: overview, token } = await fetchReportOverview(requested.code, credentials);
      const rankedRows = parseRankingRows(overview.rankings);
      const actors = overview.masterData?.actors ?? [];
      const abilities = new Map((overview.masterData?.abilities ?? []).map((ability) => [ability.gameID, ability.name]));
      const originalPullNumbers = new Map<number, number>();
      const originalPullCounters = new Map<string, number>();
      for (const fight of overview.fights.filter((candidate) => candidate.encounterID > 0)) {
        const key = `${fight.encounterID}:${fight.difficulty ?? 0}`;
        const pullNumber = (originalPullCounters.get(key) ?? 0) + 1;
        originalPullCounters.set(key, pullNumber);
        originalPullNumbers.set(fight.id, pullNumber);
      }
      const bossFights = overview.fights.filter((fight) => fight.encounterID > 0 && selectedFightIds.has(fight.id));
      if (!bossFights.length) {
        results.push({ code: requested.code, status: "skipped", pulls: 0, bosses: 0 });
        continue;
      }
      const selectedZones = [...new Set(bossFights.map((fight) => fight.gameZone?.name).filter((name): name is string => Boolean(name)))];
      const reportZoneName = selectedZones.length === 1 ? selectedZones[0] : selectedZones.length > 1 ? `${selectedZones.length} selected zones` : overview.zone?.name ?? "Unknown raid";

      if (!raidNightId) {
        raidNightId = makeId("night");
        const happenedAt = new Date(overview.startTime).toISOString();
        const defaultNight = `Raid night · ${new Date(overview.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
        await db.prepare("INSERT INTO raid_nights (id, season_id, name, happened_at) VALUES (?, ?, ?, ?)")
          .bind(raidNightId, seasonId, payload.raidNight?.trim() || defaultNight, happenedAt).run();
      }

      const reportId = makeId("report");
      await db.prepare("INSERT INTO reports (id, raid_night_id, code, url, title, zone_name, start_time, end_time, source_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live')")
        .bind(reportId, raidNightId, requested.code, requested.url, overview.title, reportZoneName, overview.startTime, overview.endTime).run();

      let playerRows = 0;
      let eventRows = 0;

      for (const fight of bossFights) {
        const bossId = `${seasonId}_encounter_${fight.encounterID}`;
        const pullId = `${reportId}_fight_${fight.id}`;
        const pullNumber = originalPullNumbers.get(fight.id) ?? 1;
        await db.batch([
          db.prepare("INSERT INTO bosses (id, season_id, encounter_id, raid_name, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season_id, encounter_id) DO UPDATE SET raid_name = excluded.raid_name, name = excluded.name")
            .bind(bossId, seasonId, fight.encounterID, fight.gameZone?.name ?? overview.zone?.name ?? "Unknown raid", fight.name),
          db.prepare("INSERT INTO pulls (id, report_id, boss_id, fight_id, pull_number, difficulty, killed, start_time, end_time, boss_percentage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(pullId, reportId, bossId, fight.id, pullNumber, fight.difficulty ?? null, fight.kill ? 1 : 0, fight.startTime, fight.endTime, fight.bossPercentage ?? null),
        ]);

        const participantIds = new Map<number, string>();
        const participantRoles = new Map<string, string>();
        for (const [participantIndex, actorId] of (fight.friendlyPlayers ?? []).entries()) {
          const actor = actors.find((candidate) => candidate.id === actorId);
          if (!actor) continue;
          const realm = actor.server ?? "";
          const playerId = await stableId("player", `${actor.name}|${realm}`);
          const ranking = rankedRows.find((row) => row.fightId === fight.id && row.name.toLowerCase() === actor.name.toLowerCase());
          const spec = ranking?.spec ?? fight.friendlySpecs?.[participantIndex] ?? "Unknown";
          const role = ranking?.role && ["Tank", "Healer", "DPS"].includes(ranking.role) ? ranking.role : roleFromSpec(spec);
          const parse = ranking?.parse ?? 0;
          const ilvlParse = ranking?.ilvlParse ?? 0;
          const performanceScore = parse > 0 ? clampScore(parse * .65 + (ilvlParse > 0 ? ilvlParse : parse) * .35) : 0;
          const amount = ranking?.amount ?? 0;
          await db.batch([
            db.prepare("INSERT INTO players (id, name, realm, class_name, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, realm) DO UPDATE SET class_name = excluded.class_name, role = excluded.role")
              .bind(playerId, actor.name, realm, actor.subType, role),
            db.prepare("INSERT INTO pull_players (id, pull_id, player_id, spec, dps, hps, parse, ilvl_parse, mechanics_score, performance_score, attendance_score, preparation_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 100, 0)")
              .bind(`${pullId}_${playerId}`, pullId, playerId, spec, role === "Healer" ? 0 : amount, role === "Healer" ? amount : 0, parse, ilvlParse, performanceScore),
          ]);
          participantIds.set(actorId, playerId);
          participantRoles.set(playerId, role);
          playerRows += 1;
        }

        const configured = await db.prepare("SELECT * FROM mechanic_rules WHERE boss_id = ? AND enabled = 1").bind(bossId).all<StoredRule>();
        const contextEvents = await fetchFightContextEvents(requested.code, fight.id, token);

        const addContextEvents = async (kind: "death" | "interrupt" | "dispel", values: unknown[]) => {
          for (const raw of values) {
            const preferSource = kind === "interrupt" || kind === "dispel";
            const playerId = participantIds.get(eventActorId(raw, preferSource));
            if (!playerId) continue;
            const event = record(raw);
            const spellId = eventSpellId(raw);
            const stoppedId = number(event.extraAbilityGameID ?? event.extraAbilityID);
            const ability = abilities.get(spellId) ?? (kind === "death" ? "Death" : kind === "interrupt" ? "Interrupt" : "Dispel");
            const stopped = stoppedId ? abilities.get(stoppedId) : null;
            const detail = kind === "death" ? "Death recorded by Warcraft Logs" : stopped ? `${kind === "interrupt" ? "Interrupted" : "Removed"} ${stopped}` : `${kind === "interrupt" ? "Interrupt" : "Dispel"} recorded by Warcraft Logs`;
            await db.prepare("INSERT INTO events (id, pull_id, player_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(makeId("event"), pullId, playerId, spellId, kind, eventTimestamp(raw, fight.startTime), number(event.amount) || null, kind === "death" ? "death" : "utility", JSON.stringify({ ability, detail, source: "Warcraft Logs" })).run();
            eventRows += 1;
          }
        };
        await addContextEvents("death", contextEvents.deaths);
        await addContextEvents("interrupt", contextEvents.interrupts);
        await addContextEvents("dispel", contextEvents.dispels);

        const penalties = new Map<string, number>();
        const countedOnce = new Set<string>();
        const difficulty = difficultyNames[fight.difficulty ?? 0] ?? "Unknown";
        for (const rule of configured.results) {
          const liveEvents = await fetchFightEvents(requested.code, fight.id, rule.spell_id, token);
          const roles = parseJson<string[]>(rule.roles_json, []);
          const difficulties = parseJson<string[]>(rule.difficulties_json, []);
          const condition = parseJson<{ minAmount?: number; countOncePerCast?: boolean; ignoreTanks?: boolean }>(rule.condition_json, {});
          for (const raw of liveEvents) {
            const preferSource = ["cast", "interrupt", "dispel"].includes(rule.event_type);
            const playerId = participantIds.get(eventActorId(raw, preferSource));
            if (!playerId) continue;
            const role = participantRoles.get(playerId) ?? "DPS";
            const event = record(raw);
            const amount = number(event.amount);
            if ((roles.length && !roles.includes(role)) || (difficulties.length && !difficulties.includes(difficulty))) continue;
            if (condition.ignoreTanks && role === "Tank") continue;
            if (condition.minAmount && amount < condition.minAmount) continue;
            const timestamp = eventTimestamp(raw, fight.startTime);
            const onceKey = `${rule.id}:${playerId}:${Math.floor(timestamp / 1000)}`;
            if (condition.countOncePerCast && countedOnce.has(onceKey)) continue;
            countedOnce.add(onceKey);
            const utility = ["Interrupt", "Dispel", "Defensive", "Utility"].includes(rule.category);
            const ability = abilities.get(rule.spell_id) ?? rule.name;
            await db.prepare("INSERT INTO events (id, pull_id, player_id, rule_id, spell_id, event_type, timestamp, amount, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .bind(makeId("event"), pullId, playerId, rule.id, rule.spell_id, String(event.type ?? rule.event_type), timestamp, amount || null, utility ? "utility" : "warning", JSON.stringify({ ability, detail: `${rule.name} matched the configured ${rule.category.toLowerCase()} rule`, severity: rule.severity, source: "Warcraft Logs" })).run();
            if (!utility) penalties.set(playerId, (penalties.get(playerId) ?? 0) + rule.weight);
            eventRows += 1;
          }
        }
        for (const [playerId, penalty] of penalties) {
          await db.prepare("UPDATE pull_players SET mechanics_score = ? WHERE pull_id = ? AND player_id = ?")
            .bind(clampScore(100 - penalty), pullId, playerId).run();
        }
      }

      results.push({
        code: requested.code,
        status: "imported",
        sourceMode: "live",
        reportId,
        pulls: bossFights.length,
        bosses: new Set(bossFights.map((fight) => fight.encounterID)).size,
        playerRows,
        relevantEvents: eventRows,
      });
    }

    return Response.json({
      reports: results,
      invalid: parsed.invalid,
      hierarchy: "Season → Raid Night → Report → Boss → Pull → Player",
      liveApiConfigured: true,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The reports could not be imported." }, { status: 500 });
  }
}
