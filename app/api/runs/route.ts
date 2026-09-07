import { ensureSchema } from "../../../db/runtime";
import type { RaidNightRecord, RaidPullRecord, RaidReportRecord } from "../../../lib/types";
import { getOfficerSession, officerRequiredResponse } from "../../../lib/officer-access";

export const runtime = "edge";

type NightRow = { id: string; name: string; happened_at: string; included: number; report_count: number; pull_count: number; active_pull_count: number };
type ReportRow = { id: string; raid_night_id: string; code: string; url: string; title: string; zone_name: string | null; included: number; pull_count: number; active_pull_count: number; boss_count: number; player_count: number };
type PullRow = { id: string; report_id: string; boss_name: string; pull_number: number; difficulty: number | null; killed: number; start_time: number; end_time: number; boss_percentage: number | null; included: number };

const difficultyNames: Record<number, string> = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };
function pullDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function readRaidNights(db: D1Database) {
  const [nightResult, reportResult, pullResult] = await Promise.all([
    db.prepare(`
      SELECT rn.id, rn.name, rn.happened_at, rn.included,
             COUNT(DISTINCT r.id) AS report_count, COUNT(DISTINCT pu.id) AS pull_count,
             COUNT(DISTINCT CASE WHEN rn.included = 1 AND r.included = 1 AND pu.included = 1 THEN pu.id END) AS active_pull_count
      FROM raid_nights rn
      LEFT JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live'
      LEFT JOIN pulls pu ON pu.report_id = r.id
      GROUP BY rn.id, rn.name, rn.happened_at, rn.included
      HAVING COUNT(DISTINCT r.id) > 0
      ORDER BY rn.included DESC, rn.happened_at DESC
    `).all<NightRow>(),
    db.prepare(`
      SELECT r.id, r.raid_night_id, r.code, r.url, r.title, r.zone_name, r.included,
             COUNT(DISTINCT pu.id) AS pull_count,
             COUNT(DISTINCT CASE WHEN r.included = 1 AND pu.included = 1 THEN pu.id END) AS active_pull_count,
             COUNT(DISTINCT pu.boss_id) AS boss_count,
             COUNT(DISTINCT pp.player_id) AS player_count
      FROM reports r
      LEFT JOIN pulls pu ON pu.report_id = r.id
      LEFT JOIN pull_players pp ON pp.pull_id = pu.id
      WHERE r.source_mode = 'live'
      GROUP BY r.id, r.raid_night_id, r.code, r.url, r.title, r.zone_name, r.included
      ORDER BY r.included DESC, r.start_time DESC
    `).all<ReportRow>(),
    db.prepare(`
      SELECT pu.id, pu.report_id, b.name AS boss_name, pu.pull_number, pu.difficulty, pu.killed,
             pu.start_time, pu.end_time, pu.boss_percentage, pu.included
      FROM pulls pu
      JOIN bosses b ON b.id = pu.boss_id
      JOIN reports r ON r.id = pu.report_id
      WHERE r.source_mode = 'live'
      ORDER BY pu.start_time
    `).all<PullRow>(),
  ]);
  const pullsByReport = new Map<string, RaidPullRecord[]>();
  for (const pull of pullResult.results) {
    const values = pullsByReport.get(pull.report_id) ?? [];
    const difficulty = difficultyNames[pull.difficulty ?? 0] ?? "Unknown";
    values.push({
      id: pull.id,
      bossName: pull.boss_name,
      pullNumber: Number(pull.pull_number),
      difficulty,
      duration: pullDuration(Number(pull.end_time) - Number(pull.start_time)),
      result: pull.killed ? "Kill" : pull.boss_percentage === null ? "Wipe" : `${Number(pull.boss_percentage).toFixed(1)}% wipe`,
      included: Boolean(pull.included),
    });
    pullsByReport.set(pull.report_id, values);
  }
  const reportsByNight = new Map<string, RaidReportRecord[]>();
  for (const report of reportResult.results) {
    const values = reportsByNight.get(report.raid_night_id) ?? [];
    values.push({
      id: report.id,
      code: report.code,
      url: report.url,
      title: report.title,
      zoneName: report.zone_name ?? "Unknown content",
      included: Boolean(report.included),
      pullCount: Number(report.pull_count),
      activePullCount: Number(report.active_pull_count),
      bossCount: Number(report.boss_count),
      playerCount: Number(report.player_count),
      pulls: pullsByReport.get(report.id) ?? [],
    });
    reportsByNight.set(report.raid_night_id, values);
  }
  return nightResult.results.map((night): RaidNightRecord => ({
    id: night.id,
    name: night.name,
    happenedAt: night.happened_at,
    included: Boolean(night.included),
    reportCount: Number(night.report_count),
    pullCount: Number(night.pull_count),
    activePullCount: Number(night.active_pull_count),
    reports: reportsByNight.get(night.id) ?? [],
  }));
}

async function permanentlyDeleteReport(db: D1Database, reportId: string) {
  await db.batch([
    db.prepare("DELETE FROM officer_notes WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM rule_analysis_state WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM events WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pull_players WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pulls WHERE report_id = ?").bind(reportId),
    db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId),
  ]);
}

export async function GET(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const db = await ensureSchema();
    return Response.json({ raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Raid nights could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { target?: "raid_night" | "report" | "pull"; id?: string; included?: boolean };
    if (!payload.id || !payload.target || !["raid_night", "report", "pull"].includes(payload.target) || typeof payload.included !== "boolean") {
      return Response.json({ error: "Choose a raid night, report, or pull and its active state." }, { status: 400 });
    }
    const db = await ensureSchema();
    const table = payload.target === "raid_night" ? "raid_nights" : payload.target === "report" ? "reports" : "pulls";
    const result = await db.prepare(`UPDATE ${table} SET included = ? WHERE id = ?`).bind(payload.included ? 1 : 0, payload.id).run();
    if (!result.meta.changes) return Response.json({ error: "That saved run no longer exists." }, { status: 404 });
    if (!payload.included) {
      const shareSql = payload.target === "raid_night"
        ? "DELETE FROM shares WHERE pull_id IN (SELECT pu.id FROM pulls pu JOIN reports r ON r.id = pu.report_id WHERE r.raid_night_id = ?)"
        : payload.target === "report"
          ? "DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)"
          : "DELETE FROM shares WHERE pull_id = ?";
      await db.prepare(shareSql).bind(payload.id).run();
    }
    return Response.json({ updated: true, raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved run could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!await getOfficerSession(request)) return officerRequiredResponse();
    const payload = await request.json() as { target?: "raid_night" | "report"; id?: string };
    if (!payload.id || !payload.target) return Response.json({ error: "Choose a raid night or report to delete." }, { status: 400 });
    const db = await ensureSchema();
    const activeImport = payload.target === "raid_night"
      ? await db.prepare("SELECT report_code FROM import_jobs WHERE raid_night_id = ? AND status != 'completed' LIMIT 1").bind(payload.id).first<{ report_code: string }>()
      : await db.prepare("SELECT ij.report_code FROM import_jobs ij JOIN reports r ON r.code = ij.report_code WHERE r.id = ? AND ij.status != 'completed' LIMIT 1").bind(payload.id).first<{ report_code: string }>();
    if (activeImport) return Response.json({ error: `${activeImport.report_code} still has an unfinished import. Resume or remove that import before deleting its saved raid data.` }, { status: 409 });
    if (payload.target === "report") {
      await permanentlyDeleteReport(db, payload.id);
    } else {
      await db.prepare("DELETE FROM officer_notes WHERE raid_night_id = ?").bind(payload.id).run();
      const reports = await db.prepare("SELECT id FROM reports WHERE raid_night_id = ?").bind(payload.id).all<{ id: string }>();
      for (const report of reports.results) await permanentlyDeleteReport(db, report.id);
      await db.prepare("DELETE FROM raid_nights WHERE id = ?").bind(payload.id).run();
    }
    return Response.json({ deleted: true, raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved run could not be permanently deleted." }, { status: 500 });
  }
}
