import { ensureSchema } from "../../../db/runtime";
import type { RaidNightRecord, RaidReportRecord } from "../../../lib/types";

export const runtime = "edge";

type NightRow = { id: string; name: string; happened_at: string; included: number; report_count: number; pull_count: number };
type ReportRow = { id: string; raid_night_id: string; code: string; url: string; title: string; zone_name: string | null; included: number; pull_count: number; boss_count: number; player_count: number };

async function readRaidNights(db: D1Database) {
  const [nightResult, reportResult] = await Promise.all([
    db.prepare(`
      SELECT rn.id, rn.name, rn.happened_at, rn.included,
             COUNT(DISTINCT r.id) AS report_count, COUNT(DISTINCT pu.id) AS pull_count
      FROM raid_nights rn
      LEFT JOIN reports r ON r.raid_night_id = rn.id AND r.source_mode = 'live'
      LEFT JOIN pulls pu ON pu.report_id = r.id
      GROUP BY rn.id, rn.name, rn.happened_at, rn.included
      HAVING COUNT(DISTINCT r.id) > 0
      ORDER BY rn.included DESC, rn.happened_at DESC
    `).all<NightRow>(),
    db.prepare(`
      SELECT r.id, r.raid_night_id, r.code, r.url, r.title, r.zone_name, r.included,
             COUNT(DISTINCT pu.id) AS pull_count, COUNT(DISTINCT pu.boss_id) AS boss_count,
             COUNT(DISTINCT pp.player_id) AS player_count
      FROM reports r
      LEFT JOIN pulls pu ON pu.report_id = r.id
      LEFT JOIN pull_players pp ON pp.pull_id = pu.id
      WHERE r.source_mode = 'live'
      GROUP BY r.id, r.raid_night_id, r.code, r.url, r.title, r.zone_name, r.included
      ORDER BY r.included DESC, r.start_time DESC
    `).all<ReportRow>(),
  ]);
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
      bossCount: Number(report.boss_count),
      playerCount: Number(report.player_count),
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
    reports: reportsByNight.get(night.id) ?? [],
  }));
}

async function permanentlyDeleteReport(db: D1Database, reportId: string) {
  await db.batch([
    db.prepare("DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM events WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pull_players WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)").bind(reportId),
    db.prepare("DELETE FROM pulls WHERE report_id = ?").bind(reportId),
    db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId),
  ]);
}

export async function GET() {
  try {
    const db = await ensureSchema();
    return Response.json({ raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Raid nights could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { target?: "raid_night" | "report"; id?: string; included?: boolean };
    if (!payload.id || !payload.target || typeof payload.included !== "boolean") {
      return Response.json({ error: "Choose a raid night or report and its active state." }, { status: 400 });
    }
    const db = await ensureSchema();
    const table = payload.target === "raid_night" ? "raid_nights" : "reports";
    const result = await db.prepare(`UPDATE ${table} SET included = ? WHERE id = ?`).bind(payload.included ? 1 : 0, payload.id).run();
    if (!result.meta.changes) return Response.json({ error: "That saved run no longer exists." }, { status: 404 });
    if (!payload.included) {
      const shareSql = payload.target === "raid_night"
        ? "DELETE FROM shares WHERE pull_id IN (SELECT pu.id FROM pulls pu JOIN reports r ON r.id = pu.report_id WHERE r.raid_night_id = ?)"
        : "DELETE FROM shares WHERE pull_id IN (SELECT id FROM pulls WHERE report_id = ?)";
      await db.prepare(shareSql).bind(payload.id).run();
    }
    return Response.json({ updated: true, raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved run could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json() as { target?: "raid_night" | "report"; id?: string };
    if (!payload.id || !payload.target) return Response.json({ error: "Choose a raid night or report to delete." }, { status: 400 });
    const db = await ensureSchema();
    if (payload.target === "report") {
      await permanentlyDeleteReport(db, payload.id);
    } else {
      const reports = await db.prepare("SELECT id FROM reports WHERE raid_night_id = ?").bind(payload.id).all<{ id: string }>();
      for (const report of reports.results) await permanentlyDeleteReport(db, report.id);
      await db.prepare("DELETE FROM raid_nights WHERE id = ?").bind(payload.id).run();
    }
    return Response.json({ deleted: true, raidNights: await readRaidNights(db) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved run could not be permanently deleted." }, { status: 500 });
  }
}
