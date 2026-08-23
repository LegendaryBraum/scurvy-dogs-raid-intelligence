import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { ...init, headers: { accept: "text/html", host: "localhost", ...init.headers } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the player-first dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Scurvy Dogs/);
  assert.match(html, /Clear next step/);
  assert.match(html, /Real raid snapshot/);
  assert.match(html, /Nek.zali the Soulcoiler/);
  assert.match(html, /Mechanics/);
  assert.match(html, /Performance/);
  assert.match(html, /score-grid-3/);
  assert.match(html, />Attendance</);
  assert.doesNotMatch(html, />Preparation</);
  assert.match(html, /Raid night/);
  assert.match(html, />History</);
  assert.match(html, /View details/);
  assert.match(html, /spell-icon-link/);
  assert.match(html, /wowhead\.com\/spell=/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("keeps importing, configuration, scoring, and privacy as separate product concerns", async () => {
  const [app, importer, reanalyzer, dashboard, scoring, schema, share, warcraftLogs, roster, modules, config, spellIcons, runs, identities, history, migration] = await Promise.all([
    readFile(new URL("../app/components/RaidApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reanalyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dashboard-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/scoring.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/share/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/warcraft-logs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/roster/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/modules/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/spell-icons/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/runs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/identities/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_special_menace.sql", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Spell ID/);
  assert.match(app, /Officer workspace/);
  assert.match(app, /score-detail-panel/);
  assert.match(app, /aria-expanded/);
  assert.match(app, /Read report contents/);
  assert.match(app, /Choose individual pulls/);
  assert.match(app, /Only the selected pulls/);
  assert.match(app, /Choose who belongs in the analysis/);
  assert.match(app, /Ignore guest/);
  assert.match(app, /Use only what matters right now/);
  assert.match(app, /Pause module/);
  assert.match(app, /Duplicate/);
  assert.match(app, /Save rule changes/);
  assert.match(app, /Keep the season history clean/);
  assert.match(app, /Link mains and alternate characters/);
  assert.match(app, /Night-by-night/);
  assert.match(app, /Replace \/ reimport/);
  assert.match(app, /function SpellIcon/);
  assert.match(app, /wowhead\.com\/spell=/);
  assert.match(importer, /fetchReportPreview/);
  assert.match(warcraftLogs, /participatingPlayerIds\.size/);
  assert.match(warcraftLogs, /keystoneAffixes/);
  assert.match(warcraftLogs, /gameZone/);
  assert.match(warcraftLogs, /abilities \{ gameID name icon \}/);
  assert.match(importer, /fetchRuleEvents/);
  assert.match(reanalyzer, /resetExisting: true/);
  assert.match(warcraftLogs, /response\.status === 429/);
  assert.match(importer, /selectedFightIds\.has\(fight\.id\)/);
  assert.match(importer, /replaceReportCodes/);
  assert.match(importer, /raidNightId/);
  assert.match(importer, /Review the report and select at least one pull/);
  assert.doesNotMatch(importer, /demoOverview|sourceMode = "demo"/);
  assert.match(dashboard, /pullPlayers/);
  assert.match(dashboard, /player_roster_settings/);
  assert.match(dashboard, /Live Warcraft Logs import/);
  assert.match(dashboard, /mr\.icon/);
  assert.match(dashboard, /r\.raid_night_id/);
  assert.match(dashboard, /attendanceByIdentity/);
  assert.match(scoring, /scoreMechanics/);
  assert.match(scoring, /scorePerformance/);
  assert.match(schema, /mechanicRules/);
  assert.match(schema, /pullPlayers/);
  assert.match(schema, /playerRosterSettings/);
  assert.match(schema, /scoreModuleSettings/);
  assert.match(schema, /playerIdentities/);
  assert.match(schema, /included: integer\("included"/);
  assert.match(modules, /score_module_settings/);
  assert.match(config, /export async function PATCH/);
  assert.match(spellIcons, /fetchReportOverview/);
  assert.match(spellIcons, /UPDATE mechanic_rules SET icon/);
  assert.match(runs, /export async function DELETE/);
  assert.match(runs, /included = \?/);
  assert.match(identities, /identity_id/);
  assert.match(history, /GROUP BY rn\.id/);
  assert.match(history, /attended \/ \(index \+ 1\)/);
  assert.match(migration, /UPDATE `score_module_settings` SET `enabled` = 1/);
  assert.match(roster, /DELETE FROM shares WHERE player_id/);
  assert.match(share, /No other player names/);
  assert.match(share, /robots: \{ index: false/);
});
