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
  assert.match(html, /Attendance/);
  assert.match(html, /Preparation/);
  assert.match(html, /View details/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("keeps importing, configuration, scoring, and privacy as separate product concerns", async () => {
  const [app, importer, dashboard, scoring, schema, share, warcraftLogs, roster] = await Promise.all([
    readFile(new URL("../app/components/RaidApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dashboard-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/scoring.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/share/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/warcraft-logs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/roster/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Spell ID/);
  assert.match(app, /Officer workspace/);
  assert.match(app, /score-detail-panel/);
  assert.match(app, /aria-expanded/);
  assert.match(app, /Review full run/);
  assert.match(app, /Confirm and import everything/);
  assert.match(app, /Choose who belongs in the analysis/);
  assert.match(app, /Ignore guest/);
  assert.match(importer, /fetchReportPreview/);
  assert.match(warcraftLogs, /participatingPlayerIds\.size/);
  assert.match(importer, /fetchFightContextEvents/);
  assert.doesNotMatch(importer, /demoOverview|sourceMode = "demo"/);
  assert.match(dashboard, /pullPlayers/);
  assert.match(dashboard, /player_roster_settings/);
  assert.match(dashboard, /Live Warcraft Logs import/);
  assert.match(scoring, /scoreMechanics/);
  assert.match(scoring, /scorePerformance/);
  assert.match(schema, /mechanicRules/);
  assert.match(schema, /pullPlayers/);
  assert.match(schema, /playerRosterSettings/);
  assert.match(roster, /DELETE FROM shares WHERE player_id/);
  assert.match(share, /No other player names/);
  assert.match(share, /robots: \{ index: false/);
});
