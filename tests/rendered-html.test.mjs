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

test("server-renders the link-locked public shell without private raid data", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Scurvy Dogs/);
  assert.match(html, /Checking this device/);
  assert.match(html, /Link access/);
  assert.doesNotMatch(html, /Nek\.zali|Real raid snapshot|score-grid-3/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("keeps importing, configuration, scoring, and privacy as separate product concerns", async () => {
  const [app, importer, reanalyzer, dashboard, scoring, schema, share, warcraftLogs, roster, modules, config, spellIcons, runs, identities, history, migration, pullMigration, accessManage, accessSession, officerAccess, ownerAccess, shareApi, privatePlaceholder, accessMigration] = await Promise.all([
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
    readFile(new URL("../drizzle/0005_lean_thunderbolt.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/access/manage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/access/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/officer-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/access/owner/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/share/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/private-placeholder.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_wandering_liz_osborn.sql", import.meta.url), "utf8"),
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
  assert.match(app, /Roster & alts/);
  assert.match(app, /Clean roster, then link/);
  assert.match(app, /role="tabpanel"/);
  assert.match(app, /Control every private link from one place/);
  assert.match(app, /Players & officers/);
  assert.match(app, /Revoke all other officer access/);
  assert.match(app, /Create one-time link/);
  assert.ok(app.indexOf("<RosterManager members") < app.indexOf("<IdentityManager members"));
  assert.match(app, /Night-by-night/);
  assert.match(app, /Replace \/ reimport/);
  assert.match(app, /Review individual pulls/);
  assert.match(app, /Exclude pull/);
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
  assert.match(runs, /"pull"/);
  assert.match(runs, /DELETE FROM shares WHERE pull_id = \?/);
  assert.match(identities, /identity_id/);
  assert.match(history, /GROUP BY rn\.id/);
  assert.match(history, /attended \/ \(index \+ 1\)/);
  assert.match(history, /pu\.included = 1/);
  assert.match(migration, /UPDATE `score_module_settings` SET `enabled` = 1/);
  assert.match(pullMigration, /ALTER TABLE `pulls` ADD `included`/);
  assert.match(pullMigration, /idx_pulls_report_included/);
  assert.match(roster, /DELETE FROM shares WHERE player_id/);
  assert.match(share, /No other player names/);
  assert.match(share, /robots: \{ index: false/);
  assert.match(accessManage, /player_access_links/);
  assert.match(accessManage, /officer_sessions/);
  assert.match(accessManage, /all_other_officers/);
  assert.match(accessManage, /currentSessionId/);
  assert.match(accessSession, /clearOfficerSessionCookie/);
  assert.match(officerAccess, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(ownerAccess, /OFFICER_BOOTSTRAP_KEY/);
  assert.match(ownerAccess, /owner_bootstrap_hash/);
  assert.match(await readFile(new URL("../app/access/officer/[token]/route.ts", import.meta.url), "utf8"), /Activate officer access/);
  assert.match(await readFile(new URL("../app/access/officer/[token]/route.ts", import.meta.url), "utf8"), /export async function POST/);
  assert.match(shareApi, /player_access_links/);
  assert.match(shareApi, /living: true/);
  assert.match(accessMigration, /CREATE TABLE `access_settings`/);
  assert.match(accessMigration, /CREATE TABLE `officers`/);
  assert.match(accessMigration, /CREATE TABLE `officer_invites`/);
  assert.match(accessMigration, /CREATE TABLE `officer_sessions`/);
  assert.match(accessMigration, /CREATE TABLE `player_access_links`/);
  assert.doesNotMatch(privatePlaceholder, /Nek\.zali|Alnima/);
  for (const privateRoute of [importer, reanalyzer, config, runs, identities, history, roster, modules, spellIcons, shareApi]) assert.match(privateRoute, /getOfficerSession/);
  assert.match(schema, /playerAccessLinks/);
  assert.match(schema, /officerSessions/);
});
