"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { DashboardData, MechanicRule, ScoreKey } from "../../lib/types";

type View = "player" | "officer" | "configure";
const scoreLabels: Record<ScoreKey, string> = { mechanics: "Mechanics", performance: "Performance", attendance: "Attendance", preparation: "Preparation" };
const scoreKeys: ScoreKey[] = ["mechanics", "performance", "attendance", "preparation"];

export function RaidApp({ initialData }: { initialData: DashboardData }) {
  const [view, setView] = useState<View>("player");
  const [activeScore, setActiveScore] = useState<ScoreKey | null>(null);
  const [playerId, setPlayerId] = useState(initialData.players[0].id);
  const [bossId, setBossId] = useState(initialData.bosses[0].id);
  const [pullId, setPullId] = useState(initialData.pulls[0].id);
  const [rules, setRules] = useState(initialData.rules);
  const [importOpen, setImportOpen] = useState(false);
  const [reportUrls, setReportUrls] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [ruleStatus, setRuleStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const player = initialData.players.find((candidate) => candidate.id === playerId) ?? initialData.players[0];
  const boss = initialData.bosses.find((candidate) => candidate.id === bossId) ?? initialData.bosses[0];
  const pullOptions = initialData.pulls.filter((pull) => pull.bossId === bossId);
  const pull = pullOptions.find((candidate) => candidate.id === pullId) ?? pullOptions[0];
  const playerEvents = initialData.events.filter((event) => event.playerId === player.id);
  const findings = playerEvents.filter((event) => event.kind === "warning" || event.kind === "death").length;
  const mechanicsScore = player.scores.mechanics ?? 0;
  const matchedRules = initialData.rules.filter((rule) => playerEvents.some((event) => event.spellId === rule.spellId));

  const officerSummary = useMemo(() => {
    const average = (key: ScoreKey) => {
      const values = initialData.players.map((candidate) => candidate.scores[key]).filter((value): value is number => value !== null);
      return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
    };
    return { mechanics: average("mechanics"), performance: average("performance"), attendance: average("attendance"), preparation: average("preparation") };
  }, [initialData.players]);

  function chooseBoss(nextBoss: string) {
    setBossId(nextBoss);
    setPullId(initialData.pulls.find((candidate) => candidate.bossId === nextBoss)?.id ?? initialData.pulls[0].id);
  }

  async function importReports(event: FormEvent) {
    event.preventDefault(); setBusy(true); setImportStatus("Reading report data…");
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: reportUrls, season: initialData.season }) });
      const result = await response.json() as { error?: string; reports?: { status: string; pulls?: number; sourceMode?: string }[]; liveApiConfigured?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      const imported = result.reports?.filter((report) => report.status === "imported") ?? [];
      const pulls = imported.reduce((total, report) => total + (report.pulls ?? 0), 0);
      const demoMode = imported.some((report) => report.sourceMode === "demo");
      setImportStatus(demoMode
        ? `${imported.length} URL stored through the demo adapter. The verified Aug 21 snapshot remains on screen.`
        : `${imported.length} report${imported.length === 1 ? "" : "s"} stored with ${pulls} pulls from Warcraft Logs.`);
      setReportUrls("");
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The report could not be imported."); }
    finally { setBusy(false); }
  }

  async function createShare() {
    setBusy(true); setShareStatus("Creating a player-only link…");
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, bossId, pullId: pull?.id }) });
      const result = await response.json() as { error?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Share link failed.");
      const fullUrl = new URL(result.url, window.location.origin).href;
      try { await navigator.clipboard.writeText(fullUrl); setShareStatus("Private link copied. It contains no teammate details."); }
      catch { setShareStatus(fullUrl); }
    } catch (error) { setShareStatus(error instanceof Error ? error.message : "The link could not be created."); }
    finally { setBusy(false); }
  }

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setRuleStatus("Saving rule…");
    const form = new FormData(event.currentTarget);
    const nextRule: MechanicRule = {
      id: `rule-${crypto.randomUUID()}`, bossId, spellId: Number(form.get("spellId")), name: String(form.get("name") ?? ""),
      category: String(form.get("category")) as MechanicRule["category"], severity: String(form.get("severity")) as MechanicRule["severity"],
      weight: Number(form.get("weight")), eventType: String(form.get("eventType")) as MechanicRule["eventType"],
      difficulties: form.getAll("difficulty").map(String), roles: form.getAll("role").map(String),
      condition: { minAmount: Number(form.get("minAmount")) || undefined, countOncePerCast: form.get("countOnce") === "on", ignoreTanks: form.get("ignoreTanks") === "on", note: String(form.get("note") ?? "") || undefined },
    };
    try {
      const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextRule) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Rule could not be saved.");
      setRules((current) => [nextRule, ...current]); setRuleStatus(`${nextRule.name} is active for future imports.`); event.currentTarget.reset();
    } catch (error) { setRuleStatus(error instanceof Error ? error.message : "Rule could not be saved."); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => setView("player")} aria-label="Scurvy Dogs home"><span className="brand-mark">SD</span><span><strong>Scurvy Dogs</strong><small>Raid Intelligence</small></span></button>
        <nav aria-label="Primary navigation">
          <button className={view === "player" ? "active" : ""} type="button" onClick={() => setView("player")}>Player view</button>
          <button className={view === "officer" ? "active" : ""} type="button" onClick={() => setView("officer")}>Officer view</button>
          <button className={view === "configure" ? "active" : ""} type="button" onClick={() => setView("configure")}>Configure</button>
        </nav>
        <div className="header-actions"><span className="demo-pill real-data">{initialData.dataSource?.label ?? "Raid dataset"}</span><button className="import-button" type="button" onClick={() => setImportOpen(true)}>Import logs</button><button className="avatar" type="button" aria-label="Open account menu">BR</button></div>
      </header>

      {view === "player" && <section className="dashboard" id="dashboard">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Player dashboard · {initialData.raidNight}</p><button className="share-button" disabled={busy} onClick={createShare} type="button">Share private view</button></div>
        <div className="hero-row"><div><h1>{mechanicsScore >= 90 ? "Good pull" : mechanicsScore >= 80 ? "Solid pull" : "Clear next step"}, {player.name}.</h1><p>{player.summary}</p></div><div className="context-chip"><span>{pull?.difficulty}</span><strong>{pull?.duration}</strong><small>{pull?.killed ? "Kill" : "Wipe"}</small></div></div>
        {initialData.dataSource && <div className="status-line data-source-line"><span /><a href={initialData.dataSource.reportUrl} target="_blank" rel="noreferrer">{initialData.dataSource.detail}</a>{initialData.dataSource.wipefestUrl && <a href={initialData.dataSource.wipefestUrl} target="_blank" rel="noreferrer">Open Wipefest</a>}</div>}
        {shareStatus && <div className="status-line" role="status"><span />{shareStatus}</div>}
        <div className="filters" aria-label="Dashboard filters">
          <label>Player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>{initialData.players.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.spec} {candidate.className}</option>)}</select></label>
          <label>Boss<select value={bossId} onChange={(event) => chooseBoss(event.target.value)}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
          <label>Pull<select value={pull?.id} onChange={(event) => setPullId(event.target.value)}>{pullOptions.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label>
          <p><span className="live-dot" /> {boss.name} · 1 of 19 pulls calibrated</p>
        </div>
        <section className="score-grid" aria-label="Player scores">
          {scoreKeys.map((key, index) => {
            const value = player.scores[key];
            const average = initialData.raidAverages[key];
            const note = key === "performance"
              ? `${player.parse ?? "—"}th WCL · ${player.ilvlParse ?? "—"}th ilvl`
              : key === "attendance" ? player.attendanceLabel
              : key === "preparation" ? player.prepLabel
              : `${findings} timeline finding${findings === 1 ? "" : "s"}`;
            const context = key === "preparation"
              ? initialData.preparationSummary
              : key === "performance"
                ? "65% WCL parse · 35% item-level parse"
                : average === null ? "No trustworthy comparison yet" : `Raid average ${average}`;
            const open = activeScore === key;
            return <button aria-controls="score-detail-panel" aria-expanded={open} className={`score-card score-card-button tone-${index} ${value === null ? "score-unavailable" : ""} ${open ? "score-card-active" : ""}`} key={key} onClick={() => setActiveScore(open ? null : key)} type="button"><span className="score-heading"><span>{scoreLabels[key]}</span><small>{note}</small></span><span className="score-value">{value === null ? "N/A" : value}{value !== null && <span>/100</span>}</span><span className="score-track"><i style={{ width: `${value ?? 0}%` }} /></span><span className="score-context">{context}</span><span className="score-card-action">{open ? "Hide details" : "View details"}<i aria-hidden="true">→</i></span></button>;
          })}
        </section>
        {activeScore && <section aria-live="polite" className={`panel score-detail-panel detail-${activeScore}`} id="score-detail-panel">
          <div className="score-detail-heading"><div><p className="eyebrow"><span /> {scoreLabels[activeScore]} detail</p><h2>{activeScore === "mechanics" ? "What changed the mechanic score" : activeScore === "performance" ? "How the performance score was built" : activeScore === "attendance" ? "What attendance currently covers" : "What preparation data is available"}</h2><p>{activeScore === "mechanics" ? "Actual Wipefest scoring, timeline events, and the matching encounter rules for this player." : activeScore === "performance" ? `Warcraft Logs ${player.role === "Healer" ? "healing" : "damage"} parses from this exact pull, shown with item-level context.` : activeScore === "attendance" ? "This is the first tracked raid night, so attendance is factual but not yet a meaningful trend." : "Wipefest exposed raid-level preparation, but not a trustworthy individual breakdown on the public report."}</p></div><button aria-label="Close score details" onClick={() => setActiveScore(null)} type="button">×</button></div>
          {activeScore === "mechanics" && <>
            <div className="score-detail-stats"><span><small>Player score</small><strong>{player.scores.mechanics ?? "N/A"}</strong><em>Wipefest</em></span><span><small>Raid average</small><strong>{initialData.raidAverages.mechanics ?? "N/A"}</strong><em>20 players</em></span><span><small>Timeline findings</small><strong>{playerEvents.length}</strong><em>{findings} need review</em></span><span><small>Matched rules</small><strong>{matchedRules.length}</strong><em>Spell-ID based</em></span></div>
            <div className="score-detail-columns"><div><h3>Events from this pull</h3><ul className="events detail-event-list">{playerEvents.map((event) => <li key={`detail-${event.id}`}><span className={`event-status ${event.kind}`}>{event.kind === "warning" || event.kind === "death" ? "!" : "✓"}</span><div><strong>{event.ability}</strong><small>{event.detail}</small></div><time>{event.timestamp}</time></li>)}</ul></div><div><h3>Rules that matched</h3><div className="detail-rule-list">{matchedRules.map((rule) => <div key={`detail-${rule.id}`}><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span><p><strong>{rule.name}</strong><small>Spell {rule.spellId} · weight {rule.weight}</small></p></div>)}{matchedRules.length === 0 && <p className="detail-empty">No configured rule matched this player&apos;s displayed timeline events.</p>}</div></div></div>
          </>}
          {activeScore === "performance" && <><div className="score-detail-stats"><span><small>WCL parse</small><strong>{player.parse ?? "N/A"}</strong><em>{player.role === "Healer" ? "Healing" : "Damage"}</em></span><span><small>Item-level parse</small><strong>{player.ilvlParse ?? "N/A"}</strong><em>Item level {player.itemLevel ?? "—"}</em></span><span><small>Performance</small><strong>{player.scores.performance ?? "N/A"}</strong><em>Transparent blend</em></span><span><small>Active pull</small><strong>{pull?.duration}</strong><em>{pull?.label}</em></span></div><div className="detail-explanation"><strong>The current formula</strong><p>Performance = 65% Warcraft Logs parse + 35% item-level parse. It keeps raw output visible while adding context for the gear available to the player. This score does not affect Mechanics, Attendance, or Preparation.</p></div></>}
          {activeScore === "attendance" && <><div className="score-detail-stats"><span><small>Tracked nights</small><strong>1/1</strong><em>Aug 21</em></span><span><small>Pull presence</small><strong>Yes</strong><em>Calibration pull</em></span><span><small>Attendance</small><strong>{player.scores.attendance ?? "N/A"}</strong><em>First baseline</em></span><span><small>Trend confidence</small><strong>Low</strong><em>More nights needed</em></span></div><div className="detail-explanation"><strong>Why this is 100 today</strong><p>{player.name} was present for the only raid night currently loaded. This will become a useful percentage only after additional scheduled nights are imported.</p></div></>}
          {activeScore === "preparation" && <><div className="score-detail-stats"><span><small>Individual score</small><strong>N/A</strong><em>Not public</em></span><span><small>Raid flasks</small><strong>16/20</strong><em>Wipefest</em></span><span><small>Raid food</small><strong>13/20</strong><em>Wipefest</em></span><span><small>Player penalty</small><strong>None</strong><em>No guessing</em></span></div><div className="detail-explanation"><strong>What we know</strong><p>{initialData.preparationSummary} The app intentionally leaves this player score blank rather than assigning the raid&apos;s preparation problem to every individual.</p></div></>}
        </section>}
        <section className="insight-grid">
          <article className="panel takeaways"><div className="panel-heading"><div><p className="eyebrow"><span /> 10-second review</p><h2>Your pull, distilled</h2></div><span className="confidence">High confidence</span></div><div className="takeaway good"><span className="takeaway-icon">✓</span><div><strong>What went well</strong><p>{player.wins.slice(0, 2).join(" · ")}</p></div></div><div className="takeaway watch"><span className="takeaway-icon">!</span><div><strong>One thing to fix</strong><p>{player.focus[0]}</p></div></div></article>
          <article className="panel event-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Key events</p><h2>What shaped the score</h2></div><span className="event-count">{playerEvents.length} relevant</span></div><ul className="events">{playerEvents.slice(0, 4).map((event) => <li key={event.id}><span className={`event-status ${event.kind}`}>{event.kind === "warning" || event.kind === "death" ? "!" : "✓"}</span><div><strong>{event.ability}</strong><small>{event.detail}</small></div><time>{event.timestamp}</time></li>)}</ul></article>
        </section>
        <section className="lower-grid">
          <article className="panel trend-panel"><div><p className="eyebrow muted"><span /> Trend</p><h2>{player.trend.length > 1 ? `Mechanics are moving ${player.trend.at(-1)! >= player.trend[0] ? "up" : "down"}` : "First mechanics baseline"}</h2><p>{player.trend.length > 1 ? "Last six evaluated pulls" : "One calibrated pull · future raids will build the trend"}</p></div><div className="trend-bars" aria-label={`Mechanics trend: ${player.trend.join(", ")}`}>{player.trend.map((value, index) => <i key={`${value}-${index}`} style={{ height: `${value}%` }}><span>{value}</span></i>)}</div></article>
          <article className="panel stat-panel"><p className="eyebrow muted"><span /> Pull facts</p><h2>Evidence, not mystery</h2><div className="fact-grid"><span><strong>{player.deaths}</strong><small>Timeline deaths</small></span><span><strong>{player.avoidableDamage >= 1000000 ? `${(player.avoidableDamage / 1000000).toFixed(1)}m` : `${Math.round(player.avoidableDamage / 1000)}k`}</strong><small>Tracked avoidable</small></span><span><strong>{player.interrupts + player.dispels}</strong><small>Dispels / utility</small></span><span><strong>{player.itemLevel ?? "—"}</strong><small>Item level</small></span></div></article>
        </section>
      </section>}

      {view === "officer" && <section className="dashboard officer-view" id="officer">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Officer workspace · full roster</p><button className="share-button" type="button" onClick={() => setImportOpen(true)}>Add raid reports</button></div>
        <div className="section-hero"><div><h1>See the whole roster, clearly.</h1><p>Four independent signals. No hidden overall score, and every rating can be traced back to what happened.</p></div><div className="hierarchy-note"><small>Current scope</small><strong>{initialData.season}</strong><span>Season → Night → Report → Boss → Pull → Player</span></div></div>
        <section className="officer-summary">{scoreKeys.map((key) => {
          const value = officerSummary[key];
          return <article key={key}><span>{scoreLabels[key]} average</span><strong>{value ?? "N/A"}</strong><small>{value === null ? "Not public" : key === "attendance" ? "First tracked night" : "Real snapshot"}</small></article>;
        })}</section>
        <article className="panel roster-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Roster comparison</p><h2>{boss.name} · {pull?.label}</h2></div><div className="legend"><span><i className="good-dot" /> 90+</span><span><i className="watch-dot" /> Below 80</span></div></div><div className="table-scroll"><table><thead><tr><th>Player</th><th>Role</th><th>Mechanics</th><th>Performance</th><th>Attendance</th><th>Preparation</th><th>Review</th></tr></thead><tbody>{[...initialData.players].sort((a, b) => (b.scores.mechanics ?? -1) - (a.scores.mechanics ?? -1)).map((candidate) => { const needsReview = scoreKeys.some((key) => candidate.scores[key] !== null && candidate.scores[key] < 80); return <tr key={candidate.id}><td><button className="player-cell" type="button" onClick={() => { setPlayerId(candidate.id); setView("player"); }}><span>{candidate.name.slice(0, 2).toUpperCase()}</span><strong>{candidate.name}<small>{candidate.spec} {candidate.className}</small></strong></button></td><td>{candidate.role}</td>{scoreKeys.map((key) => { const value = candidate.scores[key]; return <td key={key}><span className={`table-score ${value !== null && value >= 90 ? "high" : value !== null && value < 80 ? "low" : ""}`}>{value ?? "—"}</span></td>; })}<td><span className={`review-chip ${needsReview ? "attention" : "clear"}`}>{needsReview ? "Needs context" : "Clear"}</span></td></tr>; })}</tbody></table></div></article>
        <div className="officer-footnote"><strong>Privacy by workflow</strong><span>Officers compare the full roster here. Player links are generated separately and include only one player plus anonymous averages.</span></div>
      </section>}

      {view === "configure" && <section className="dashboard config-view" id="configure">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Encounter configuration</p><button className="share-button" type="button" onClick={() => setImportOpen(true)}>Import reports</button></div>
        <div className="section-hero"><div><h1>Define what matters once.</h1><p>The engine stays the same. Each raid tier is maintained here as a set of readable, editable mechanic rules.</p></div><div className="engine-note"><span>Configuration</span><b>→</b><span>Analysis engine</span><b>→</b><span>Four scores</span></div></div>
        <div className="config-filters"><label>Raid<select defaultValue={initialData.raid}><option>{initialData.raid}</option></select></label><label>Boss<select value={bossId} onChange={(event) => chooseBoss(event.target.value)}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label><div><span>Active rules</span><strong>{rules.filter((rule) => rule.bossId === bossId).length}</strong></div></div>
        <section className="config-grid">
          <article className="panel rules-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Rule library</p><h2>{boss.name}</h2></div><span className="confidence">Config-driven</span></div><div className="rule-list">{rules.filter((rule) => rule.bossId === bossId).map((rule) => <div className="rule-row" key={rule.id}><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span><div><strong>{rule.name}</strong><small>Spell {rule.spellId} · {rule.category}</small><p>{rule.roles.join(", ")} · {rule.difficulties.join(", ")}{rule.condition.note ? ` · ${rule.condition.note}` : ""}</p></div><b>−{rule.weight}</b></div>)}{!rules.some((rule) => rule.bossId === bossId) && <div className="empty-rules">No rules for this boss yet. Add the first one beside this list.</div>}</div></article>
          <form className="panel rule-form" onSubmit={addRule}><p className="eyebrow"><span /> New mechanic rule</p><h2>Teach the analyzer</h2><div className="form-pair"><label>Mechanic name<input name="name" placeholder="e.g. Gilded Wave" required /></label><label>Spell ID<input name="spellId" inputMode="numeric" placeholder="451117" required /></label></div><div className="form-pair"><label>Category<select name="category" defaultValue="Avoidable damage"><option>Avoidable damage</option><option>Mechanic failure</option><option>Interrupt</option><option>Dispel</option><option>Defensive</option><option>Soak</option><option>Utility</option></select></label><label>Event type<select name="eventType" defaultValue="damage"><option>damage</option><option>debuff</option><option>cast</option><option>interrupt</option><option>dispel</option><option>death</option></select></label></div><div className="form-pair"><label>Severity<select name="severity" defaultValue="Medium"><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label><label>Penalty weight<input name="weight" inputMode="decimal" defaultValue="4" required /></label></div><fieldset><legend>Applies on</legend><label><input name="difficulty" type="checkbox" value="Normal" /> Normal</label><label><input name="difficulty" type="checkbox" value="Heroic" defaultChecked /> Heroic</label><label><input name="difficulty" type="checkbox" value="Mythic" defaultChecked /> Mythic</label></fieldset><fieldset><legend>Roles</legend><label><input name="role" type="checkbox" value="Tank" defaultChecked /> Tanks</label><label><input name="role" type="checkbox" value="Healer" defaultChecked /> Healers</label><label><input name="role" type="checkbox" value="DPS" defaultChecked /> DPS</label></fieldset><details><summary>Optional conditions</summary><label>Minimum amount<input name="minAmount" inputMode="numeric" placeholder="50000" /></label><label className="checkline"><input name="countOnce" type="checkbox" /> Count once per cast</label><label className="checkline"><input name="ignoreTanks" type="checkbox" /> Ignore tanks</label><label>Rule note<textarea name="note" placeholder="Ignore the first unavoidable tick…" /></label></details><button className="primary-button" disabled={busy} type="submit">Save mechanic rule</button>{ruleStatus && <p className="form-status" role="status">{ruleStatus}</p>}</form>
        </section>
      </section>}

      {importOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setImportOpen(false)}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow"><span /> Warcraft Logs import</p><h2 id="import-title">Add one report or a whole raid week</h2></div><button type="button" onClick={() => setImportOpen(false)} aria-label="Close import">×</button></div><p>Paste one Warcraft Logs report URL per line. Reports are normalized into the season hierarchy, then evaluated against active boss rules.</p><form onSubmit={importReports}><label>Report URLs<textarea autoFocus value={reportUrls} onChange={(event) => setReportUrls(event.target.value)} placeholder={"https://www.warcraftlogs.com/reports/ABC12345\nhttps://www.warcraftlogs.com/reports/XYZ98765"} required /></label><div className="import-path"><span>Season</span><b>→</b><span>Raid night</span><b>→</b><span>Report</span><b>→</b><span>Boss</span><b>→</b><span>Pull</span><b>→</b><span>Player</span></div><button className="primary-button" disabled={busy} type="submit">{busy ? "Importing…" : "Import and analyze"}</button>{importStatus && <p className="form-status" role="status">{importStatus}</p>}</form><small className="credential-note">The Aug 21 report shown behind this dialog is a verified real-data snapshot. New URLs will replace it automatically once the live Warcraft Logs connection is enabled.</small></section></div>}
    </main>
  );
}
