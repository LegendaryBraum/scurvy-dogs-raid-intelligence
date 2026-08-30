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
  const [app, importer, importJobs, reanalyzer, dashboard, scoring, schema, share, warcraftLogs, roster, modules, config, spellIcons, runs, identities, history, migration, pullMigration, accessManage, accessSession, officerAccess, ownerAccess, shareApi, privatePlaceholder, accessMigration, wclStatus, importJobMigration] = await Promise.all([
    readFile(new URL("../app/components/RaidApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import-jobs/route.ts", import.meta.url), "utf8"),
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
    readFile(new URL("../app/api/wcl-status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_sleepy_skreet.sql", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Spell ID/);
  assert.match(app, /Officer workspace/);
  assert.match(app, /score-detail-panel/);
  assert.match(app, /aria-expanded/);
  assert.match(app, /Read report contents/);
  assert.match(app, /Where do you want to start/);
  assert.match(app, /Return to Scurvy Dogs home/);
  assert.match(app, /Warcraft Logs ready/);
  assert.match(app, /Allowance getting low/);
  assert.match(app, /safely checkpointed/);
  assert.match(app, /of .* pulls analyzed/);
  assert.match(app, /Remove unfinished import/);
  assert.match(app, /Retry from last checkpoint/);
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
  assert.match(app, /Reusable player link/);
  assert.match(app, /Pending officer link/);
  assert.ok(app.indexOf("<RosterManager members") < app.indexOf("<IdentityManager members"));
  assert.match(app, /night-by-night/i);
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
  assert.match(importJobs, /fetchRuleEvents/);
  assert.match(reanalyzer, /resetExisting: true/);
  assert.match(warcraftLogs, /WarcraftLogsRateLimitError/);
  assert.match(warcraftLogs, /hourly API allowance is temporarily full/);
  assert.match(warcraftLogs, /rateLimitData \{ limitPerHour pointsSpentThisHour pointsResetIn \}/);
  assert.match(spellIcons, /fetchReportAbilities/);
  assert.doesNotMatch(spellIcons, /fetchReportOverview/);
  assert.match(importer, /status: 429/);
  assert.match(importJobs, /completed_fight_ids_json/);
  assert.match(importJobs, /source_mode = 'live'/);
  assert.match(importJobs, /source_mode, included.*'importing', 0/);
  assert.match(importJobs, /replaceReportCodes/);
  assert.match(importJobs, /raidNightId/);
  assert.match(importJobs, /Review the report and select at least one pull/);
  assert.match(importJobs, /status = 'paused'/);
  assert.match(importJobs, /status = 'completed'/);
  assert.doesNotMatch(importJobs, /demoOverview|sourceMode = "demo"/);
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
  assert.match(schema, /importJobs/);
  assert.match(schema, /included: integer\("included"/);
  assert.match(modules, /score_module_settings/);
  assert.match(config, /export async function PATCH/);
  assert.match(spellIcons, /fetchReportAbilities/);
  assert.match(spellIcons, /UPDATE mechanic_rules SET icon/);
  assert.match(runs, /export async function DELETE/);
  assert.match(runs, /included = \?/);
  assert.match(runs, /"pull"/);
  assert.match(runs, /DELETE FROM shares WHERE pull_id = \?/);
  assert.match(identities, /identity_id/);
  const playerHistory = await readFile(new URL("../lib/player-history.ts", import.meta.url), "utf8");
  assert.match(history, /loadPlayerHistory/);
  assert.match(history, /difficulty/);
  assert.match(playerHistory, /GROUP BY rn\.id/);
  assert.match(playerHistory, /attended \/ \(index \+ 1\)/);
  assert.match(playerHistory, /pu\.included = 1/);
  assert.match(playerHistory, /difficulty_pull\.difficulty = \?/);
  assert.match(migration, /UPDATE `score_module_settings` SET `enabled` = 1/);
  assert.match(pullMigration, /ALTER TABLE `pulls` ADD `included`/);
  assert.match(pullMigration, /idx_pulls_report_included/);
  assert.match(roster, /DELETE FROM shares WHERE player_id/);
  assert.match(share, /PrivatePlayerDashboard/);
  assert.match(share, /robots: \{ index: false/);
  const privateDashboard = await readFile(new URL("../app/share/[token]/PrivatePlayerDashboard.tsx", import.meta.url), "utf8");
  const playerAccessData = await readFile(new URL("../lib/player-access-data.ts", import.meta.url), "utf8");
  const playerAccessApi = await readFile(new URL("../app/api/player/[token]/route.ts", import.meta.url), "utf8");
  const notesApi = await readFile(new URL("../app/api/notes/route.ts", import.meta.url), "utf8");
  const officerNotes = await readFile(new URL("../lib/officer-notes.ts", import.meta.url), "utf8");
  const coachingNotes = await readFile(new URL("../app/components/CoachingNotes.tsx", import.meta.url), "utf8");
  const officerNotesPanel = await readFile(new URL("../app/components/OfficerNotesPanel.tsx", import.meta.url), "utf8");
  const officerHistoryApi = await readFile(new URL("../app/api/officer-history/route.ts", import.meta.url), "utf8");
  const officerHistoryRoster = await readFile(new URL("../app/components/OfficerHistoryRoster.tsx", import.meta.url), "utf8");
  const notesMigration = await readFile(new URL("../drizzle/0009_careless_jackpot.sql", import.meta.url), "utf8");
  assert.match(privateDashboard, /Raid night/);
  assert.match(privateDashboard, /Boss/);
  assert.match(privateDashboard, /Difficulty/);
  assert.match(privateDashboard, /Pull/);
  assert.match(privateDashboard, /Full history/);
  assert.match(privateDashboard, /Mechanics & spell details/);
  assert.match(privateDashboard, /wowhead\.com\/spell=/);
  assert.match(privateDashboard, /No teammate names or individual teammate reports/);
  assert.match(privateDashboard, /CoachingNotes/);
  assert.match(playerAccessData, /allowedPlayerIds\.has/);
  assert.match(playerAccessData, /pullEvents\[pull\.id\].*filter/);
  assert.match(playerAccessData, /pullRaidAverages/);
  assert.match(playerAccessData, /loadPlayerVisibleNotes/);
  assert.match(playerAccessData, /selectedDifficulty/);
  assert.match(playerAccessApi, /loadPrivatePlayerWorkspace/);
  assert.match(playerAccessApi, /searchParams\.get\("difficulty"\)/);
  assert.match(playerAccessApi, /X-Robots-Tag/);
  assert.match(accessManage, /player_access_links/);
  assert.match(accessManage, /officer_sessions/);
  assert.match(accessManage, /all_other_officers/);
  assert.match(accessManage, /currentSessionId/);
  assert.match(accessManage, /candidate\.token \? new URL/);
  assert.match(accessManage, /token = NULL/);
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
  assert.match(await readFile(new URL("../drizzle/0007_nosy_flatman.sql", import.meta.url), "utf8"), /ADD `token` text/);
  assert.match(importJobMigration, /CREATE TABLE `import_jobs`/);
  assert.doesNotMatch(privatePlaceholder, /Nek\.zali|Alnima/);
  assert.match(wclStatus, /fetchRateLimitStatus/);
  assert.match(wclStatus, /status: 429/);
  assert.match(notesApi, /export async function GET/);
  assert.match(notesApi, /export async function POST/);
  assert.match(notesApi, /export async function PATCH/);
  assert.match(notesApi, /export async function DELETE/);
  assert.match(notesApi, /session\.officerId/);
  assert.match(notesApi, /1,500 characters or fewer/);
  assert.match(officerNotes, /n\.visibility = 'player'/);
  assert.match(officerNotes, /resolveRaiderIdentity/);
  assert.match(officerNotesPanel, /Player-visible/);
  assert.match(officerNotesPanel, /Officers only/);
  assert.match(officerNotesPanel, /This pull/);
  assert.match(app, /See the whole season, clearly/);
  assert.match(app, /OfficerHistoryRoster/);
  assert.match(app, /Difficulty stage/);
  assert.match(app, /All difficulties/);
  assert.match(app, /choosePlayerDifficulty/);
  assert.doesNotMatch(app, /<article className="panel roster-panel"/);
  assert.match(officerHistoryApi, /COALESCE\(pi\.identity_id, p\.id\)/);
  assert.match(officerHistoryApi, /AVG\(NULLIF\(pp\.performance_score, 0\)\)/);
  assert.match(officerHistoryApi, /pu\.killed = 1/);
  assert.match(officerHistoryApi, /COUNT\(DISTINCT rn\.id\)/);
  assert.match(officerHistoryApi, /pu\.difficulty = \?/);
  assert.match(officerHistoryApi, /difficulties:/);
  assert.match(officerHistoryRoster, /roster history/);
  assert.match(officerHistoryRoster, /aria-expanded/);
  assert.match(officerHistoryRoster, /averages with every saved kill underneath/);
  assert.match(officerHistoryRoster, /Notes here stay attached to this exact kill/);
  assert.match(officerHistoryRoster, /scope: "pull"/);
  assert.match(coachingNotes, /audience === "officer"/);
  assert.match(notesMigration, /CREATE TABLE `officer_notes`/);
  assert.match(notesMigration, /`visibility` text DEFAULT 'player'/);
  assert.match(schema, /officerNotes/);
  assert.match(runs, /DELETE FROM officer_notes WHERE raid_night_id/);
  assert.match(importJobs, /UPDATE officer_notes SET pull_id/);
  assert.match(identities, /UPDATE officer_notes SET player_id/);
  for (const privateRoute of [importer, importJobs, reanalyzer, config, runs, identities, history, roster, modules, spellIcons, shareApi, wclStatus, notesApi, officerHistoryApi]) assert.match(privateRoute, /getOfficerSession/);
  assert.match(schema, /playerAccessLinks/);
  assert.match(schema, /officerSessions/);
});
