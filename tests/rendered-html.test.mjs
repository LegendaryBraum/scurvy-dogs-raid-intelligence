import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", host: "localhost" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the player-first dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Scurvy Dogs/);
  assert.match(html, /Good pull/);
  assert.match(html, /Mechanics/);
  assert.match(html, /Performance/);
  assert.match(html, /Attendance/);
  assert.match(html, /Preparation/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("keeps configuration, scoring, and privacy as separate product concerns", async () => {
  const [app, scoring, schema, share] = await Promise.all([
    readFile(new URL("../app/components/RaidApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/scoring.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/share/[token]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Spell ID/);
  assert.match(app, /Officer workspace/);
  assert.match(scoring, /scoreMechanics/);
  assert.match(scoring, /scorePerformance/);
  assert.match(schema, /mechanicRules/);
  assert.match(schema, /pullPlayers/);
  assert.match(share, /No other player names/);
  assert.match(share, /robots: \{ index: false/);
});
