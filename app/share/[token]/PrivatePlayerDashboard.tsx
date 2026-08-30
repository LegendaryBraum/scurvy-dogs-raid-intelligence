"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import type { MechanicRule, PlayerHistoryPoint, PlayerSnapshot, PrivatePlayerWorkspace, RaidEvent, ScoreKey } from "../../../lib/types";
import { CoachingNotes } from "../../components/CoachingNotes";

const scoreKeys: ScoreKey[] = ["mechanics", "performance", "attendance", "preparation"];
const scoreLabels: Record<ScoreKey, string> = { mechanics: "Mechanics", performance: "Performance", attendance: "Attendance", preparation: "Preparation" };

function wowheadUrl(spellId: number) { return `https://www.wowhead.com/spell=${spellId}`; }
function iconUrl(icon?: string) {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;
  const filename = icon.split("/").at(-1)?.replace(/\.(?:jpe?g|png|webp)$/i, "").toLowerCase();
  return filename ? `https://wow.zamimg.com/images/wow/icons/large/${encodeURIComponent(filename)}.jpg` : null;
}
function SpellIcon({ spellId, icon, name }: { spellId: number; icon?: string; name: string }) {
  const source = iconUrl(icon);
  return <a aria-label={`Look up ${name}, Spell ${spellId}`} className="spell-icon-link" href={wowheadUrl(spellId)} rel="noreferrer" target="_blank" title={`Look up ${name} · Spell ${spellId}`}><span className="spell-icon-fallback">?</span>{source && <img alt="" className="spell-icon" onError={(event) => { event.currentTarget.style.display = "none"; }} src={source} />}</a>;
}
function EventIcon({ event, rule }: { event: RaidEvent; rule?: MechanicRule }) {
  return <span className="event-spell"><SpellIcon icon={event.icon ?? rule?.icon} name={event.ability} spellId={event.spellId} /><span aria-hidden="true" className={`event-status ${event.kind}`}>{event.kind === "warning" || event.kind === "death" ? "!" : "✓"}</span></span>;
}
function compact(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function HistoryView({ history, player, linkedCharacters, activeKeys }: { history: PlayerHistoryPoint[]; player: PlayerSnapshot; linkedCharacters: string[]; activeKeys: ScoreKey[] }) {
  const latest = history.at(-1);
  if (!latest) return <section className="panel history-empty"><strong>No raid-night history yet</strong><p>The first included night will appear here automatically.</p></section>;
  return <section className="history-view private-history-view">
    <article className="panel history-hero"><div><p className="eyebrow"><span /> Season history</p><h2>{history.length === 1 ? "Your first weekly baseline" : `${history.length} raid nights, one clear timeline`}</h2><p>{linkedCharacters.length > 1 ? `Attendance combines ${linkedCharacters.join(" and ")}. ` : ""}Every value below belongs only to this raider identity.</p></div><div className="history-latest"><small>Latest night</small><strong>{latest.present ? "Present" : "Absent"}</strong><span>{latest.pulls} pull{latest.pulls === 1 ? "" : "s"}</span></div></article>
    <div className="history-score-grid">{activeKeys.map((key) => <article className="panel history-metric" key={key}><div><span>{scoreLabels[key]}</span><strong>{latest.scores[key] ?? "—"}</strong></div><div className="history-bars" aria-label={`${scoreLabels[key]} by raid night`}>{history.map((point) => <span key={point.raidNightId}><i style={{ height: `${point.scores[key] ?? 4}%` }} /><b>{point.scores[key] ?? "—"}</b><small>{new Date(point.happenedAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}</small></span>)}</div></article>)}</div>
    <article className="panel history-table"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Night-by-night</p><h2>Progress without the guesswork</h2></div><span className="confidence">Player only</span></div><div className="table-scroll"><table><thead><tr><th>Raid night</th><th>Present</th><th>Pulls</th><th>Mechanics</th><th>Performance</th><th>Attendance</th><th>{player.role === "Healer" ? "Avg HPS" : "Avg DPS"}</th></tr></thead><tbody>{[...history].reverse().map((point) => <tr key={point.raidNightId}><td><strong>{new Date(point.happenedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{point.label}</small></td><td><span className={`review-chip ${point.present ? "clear" : "attention"}`}>{point.present ? "Yes" : "No"}</span></td><td>{point.pulls}</td><td>{point.scores.mechanics ?? "—"}</td><td>{point.scores.performance ?? "—"}</td><td>{point.scores.attendance ?? "—"}</td><td>{compact(player.role === "Healer" ? point.hps : point.dps)}</td></tr>)}</tbody></table></div></article>
  </section>;
}

export function PrivatePlayerDashboard({ initialWorkspace, token }: { initialWorkspace: PrivatePlayerWorkspace; token: string }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [tab, setTab] = useState<"review" | "history">("review");
  const [bossId, setBossId] = useState(initialWorkspace.dashboard.bosses[0]?.id ?? "");
  const [pullId, setPullId] = useState(initialWorkspace.dashboard.pulls[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const data = workspace.dashboard;
  const boss = data.bosses.find((candidate) => candidate.id === bossId) ?? data.bosses[0];
  const pullOptions = data.pulls.filter((pull) => pull.bossId === boss?.id);
  const pull = pullOptions.find((candidate) => candidate.id === pullId) ?? pullOptions[0] ?? data.pulls[0];
  const pullPlayers = data.pullPlayers?.[pull?.id] ?? [];
  const player = pullPlayers[0] ?? data.players[0];
  const events = data.pullEvents?.[pull?.id] ?? [];
  const activeRules = data.rules.filter((rule) => rule.enabled !== false && rule.bossId === boss?.id);
  const rulesBySpell = useMemo(() => new Map(data.rules.map((rule) => [rule.spellId, rule])), [data.rules]);
  const matchedSpellIds = new Set(events.map((event) => event.spellId));
  const matchedRules = activeRules.filter((rule) => matchedSpellIds.has(rule.spellId));
  const activeScoreKeys = scoreKeys.filter((key) => data.moduleSettings[key]);
  const raidAverages = workspace.pullRaidAverages[pull?.id] ?? data.raidAverages;
  const findings = events.filter((event) => event.kind === "warning" || event.kind === "death").length;

  async function chooseRaidNight(raidNightId: string) {
    setLoading(true); setStatus("Loading that raid night…");
    try {
      const response = await fetch(`/api/player/${encodeURIComponent(token)}?raidNightId=${encodeURIComponent(raidNightId)}`, { cache: "no-store" });
      const result = await response.json() as { workspace?: PrivatePlayerWorkspace; error?: string };
      if (!response.ok || !result.workspace) throw new Error(result.error ?? "That raid night could not be loaded.");
      setWorkspace(result.workspace);
      const nextBoss = result.workspace.dashboard.bosses[0];
      setBossId(nextBoss?.id ?? "");
      setPullId(result.workspace.dashboard.pulls.find((candidate) => candidate.bossId === nextBoss?.id)?.id ?? result.workspace.dashboard.pulls[0]?.id ?? "");
      setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "That raid night could not be loaded."); }
    finally { setLoading(false); }
  }
  function chooseBoss(nextBossId: string) {
    setBossId(nextBossId);
    setPullId(data.pulls.find((candidate) => candidate.bossId === nextBossId)?.id ?? "");
  }
  if (!player || !boss || !pull) return <main className="private-shell"><section className="private-report"><article className="panel history-empty"><strong>No included pull is available yet</strong><p>This living link will populate automatically after the player appears in an included raid pull.</p></article></section></main>;

  return <main className="private-shell private-workspace-shell">
    <header className="private-topbar"><a className="brand" href={`/share/${token}`} aria-label="Reload this private player dashboard"><span className="brand-mark">SD</span><span><strong>Scurvy Dogs</strong><small>Private player workspace</small></span></a><span className="privacy-badge">{workspace.playerName} only</span></header>
    <section className="private-report private-full-report">
      <div className="eyebrow-row"><p className="eyebrow"><span /> {data.season} · {data.raidNight}</p><span className="private-live-note">Living link · updates with the raid</span></div>
      <div className="private-hero private-dashboard-hero"><div><h1>{workspace.playerName}&apos;s complete raid view</h1><p>{player.summary}</p></div><div className="player-seal"><strong>{workspace.playerName.slice(0, 2).toUpperCase()}</strong><span>{player.spec}<br />{player.className}</span></div></div>
      {data.dataSource && <div className="status-line data-source-line"><span /><a href={data.dataSource.reportUrl} rel="noreferrer" target="_blank">{data.dataSource.detail}</a><b>Only {workspace.playerName}&apos;s details are shown here</b></div>}
      {status && <div className="status-line" role="status"><span />{status}</div>}
      <div className="filters private-filters" aria-label="Private player dashboard filters"><label>Raid night<select disabled={loading} value={data.raidNightId ?? ""} onChange={(event) => chooseRaidNight(event.target.value)}>{(data.raidNights ?? []).map((night) => <option value={night.id} key={night.id}>{night.name}</option>)}</select></label><label>Boss<select value={boss.id} onChange={(event) => chooseBoss(event.target.value)}>{data.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label><label>Pull<select value={pull.id} onChange={(event) => setPullId(event.target.value)}>{pullOptions.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label><p><span className="live-dot" /> {activeRules.length} active rules · {pullOptions.length} pull{pullOptions.length === 1 ? "" : "s"}</p></div>
      <CoachingNotes notes={workspace.notes} raidNightId={data.raidNightId} bossId={boss.id} pullId={pull.id} audience="player" />
      <div className="player-tabs private-player-tabs" role="tablist" aria-label="Private player sections"><button aria-selected={tab === "review"} className={tab === "review" ? "active" : ""} onClick={() => setTab("review")} role="tab" type="button">Pull review</button><button aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} role="tab" type="button">Full history</button></div>
      {tab === "review" && <>
        <section className={`score-grid score-grid-${activeScoreKeys.length} private-scores`} aria-label={`${workspace.playerName}'s scores`}>{activeScoreKeys.map((key) => { const value = player.scores[key]; const note = key === "performance" ? `${player.parse ?? "—"}th WCL · ${player.ilvlParse ?? "—"}th ilvl` : key === "attendance" ? player.attendanceLabel : key === "preparation" ? player.prepLabel : `${findings} finding${findings === 1 ? "" : "s"}`; return <article className={`score-card tone-${scoreKeys.indexOf(key)} ${value === null ? "score-unavailable" : ""}`} key={key}><div className="score-heading"><span>{scoreLabels[key]}</span><small>{note}</small></div><div className="score-value">{value ?? "N/A"}{value !== null && <span>/100</span>}</div><div className="score-track"><i style={{ width: `${value ?? 0}%` }} /></div><span className="score-context">{raidAverages[key] === null ? "No anonymous comparison yet" : `Raid average ${raidAverages[key]}`}</span></article>; })}</section>
        <section className="insight-grid private-insight-grid"><article className="panel takeaways"><div className="panel-heading"><div><p className="eyebrow"><span /> 10-second review</p><h2>Your pull, distilled</h2></div><span className="confidence">Player only</span></div><div className="takeaway good"><span className="takeaway-icon">✓</span><div><strong>What went well</strong><p>{player.wins.slice(0, 2).join(" · ")}</p></div></div><div className="takeaway watch"><span className="takeaway-icon">!</span><div><strong>One thing to fix</strong><p>{player.focus[0]}</p></div></div></article><article className="panel stat-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Pull facts</p><h2>Evidence, not mystery</h2></div><span className={`pull-result ${pull.killed ? "kill" : "wipe"}`}>{pull.killed ? "Kill" : "Wipe"}</span></div><div className="fact-grid"><span><strong>{player.deaths}</strong><small>Deaths</small></span><span><strong>{compact(player.avoidableDamage)}</strong><small>Tracked avoidable</small></span><span><strong>{player.interrupts + player.dispels}</strong><small>Utility</small></span><span><strong>{pull.duration}</strong><small>Duration</small></span></div></article></section>
        <section className="panel private-mechanics-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Mechanics & spell details</p><h2>Everything recorded for this pull</h2></div><span className="event-count">{events.length} player event{events.length === 1 ? "" : "s"}</span></div><div className="score-detail-columns"><div><h3>{workspace.playerName}&apos;s timeline</h3><ul className="events detail-event-list">{events.map((event) => <li key={event.id}><EventIcon event={event} rule={rulesBySpell.get(event.spellId)} /><div><a className="event-ability-link" href={wowheadUrl(event.spellId)} rel="noreferrer" target="_blank">{event.ability}</a><small>{event.detail} · Spell {event.spellId}</small></div><time>{event.timestamp}</time></li>)}{events.length === 0 && <li className="private-empty-event"><div><strong>No relevant timeline events</strong><small>No active rule recorded a player-specific event on this pull.</small></div></li>}</ul></div><div><h3>Encounter rules</h3><div className="detail-rule-list">{activeRules.map((rule) => <div className={matchedRules.some((match) => match.id === rule.id) ? "private-rule-matched" : ""} key={rule.id}><SpellIcon icon={rule.icon} name={rule.name} spellId={rule.spellId} /><p><strong>{rule.name}</strong><small><a href={wowheadUrl(rule.spellId)} rel="noreferrer" target="_blank">Spell {rule.spellId}</a> · {rule.category} · weight {rule.weight}</small></p><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span></div>)}{activeRules.length === 0 && <p className="detail-empty">No configured rules are active for this boss yet.</p>}</div></div></div></section>
        <section className="anonymous-context panel private-anonymous-context"><div><p className="eyebrow muted"><span /> Anonymous context</p><h2>Full detail without roster drama</h2><p>This page includes the complete selected player record, encounter rules, and anonymous raid averages. No teammate names or individual teammate reports are sent to this link.</p></div><div className="private-comparison-grid">{activeScoreKeys.map((key) => <span key={key}><small>{scoreLabels[key]}</small><strong>{player.scores[key] ?? "—"}</strong><em>Raid {raidAverages[key] ?? "—"}</em></span>)}</div></section>
      </>}
      {tab === "history" && <HistoryView activeKeys={activeScoreKeys} history={workspace.history} linkedCharacters={workspace.linkedCharacters} player={player} />}
      <footer className="private-footer">Living player link · {workspace.linkedCharacters.length > 1 ? `linked identity: ${workspace.linkedCharacters.join(", ")}` : `${workspace.playerName} only`} · refreshes from included raid data</footer>
    </section>
  </main>;
}
