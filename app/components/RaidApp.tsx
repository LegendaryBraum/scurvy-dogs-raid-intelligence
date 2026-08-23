"use client";

/* eslint-disable jsx-a11y/label-has-associated-control, jsx-a11y/no-autofocus, jsx-a11y/no-noninteractive-element-interactions */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DashboardData, MechanicRule, RosterMember, ScoreKey } from "../../lib/types";

type View = "player" | "officer" | "configure";
type ImportFight = { id: number; name: string; pullNumber: number; difficulty: string; duration: string; result: string; playerCount: number };
type ImportGroup = { id: string; label: string; description: string; kind: "raid" | "mythic_plus" | "other"; defaultSelected: boolean; fights: ImportFight[] };
type ImportPreview = { code: string; title: string; raid: string; visibility: string; startedAt: number; pullCount: number; playerCount: number; bosses: { name: string; pulls: number; kills: number }[]; groups: ImportGroup[] };
const scoreLabels: Record<ScoreKey, string> = { mechanics: "Mechanics", performance: "Performance", attendance: "Attendance", preparation: "Preparation" };
const scoreKeys: ScoreKey[] = ["mechanics", "performance", "attendance", "preparation"];

function ImportModal({ reportUrls, previews, selections, busy, status, onClose, onUrlsChange, onReview, onConfirm, onToggleGroup, onToggleFight, onReset }: { reportUrls: string; previews: ImportPreview[]; selections: Record<string, number[]>; busy: boolean; status: string; onClose: () => void; onUrlsChange: (value: string) => void; onReview: (event: FormEvent) => void; onConfirm: () => void; onToggleGroup: (code: string, group: ImportGroup, selected: boolean) => void; onToggleFight: (code: string, fightId: number) => void; onReset: () => void }) {
  const selectedCount = Object.values(selections).reduce((total, ids) => total + ids.length, 0);
  const foundCount = previews.reduce((total, preview) => total + preview.pullCount, 0);
  const excludedCount = Math.max(0, foundCount - selectedCount);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal selective-import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow"><span /> Warcraft Logs import</p><h2 id="import-title">{previews.length ? "Choose exactly what to import" : "Review the full run before importing"}</h2></div><button type="button" onClick={onClose} aria-label="Close import">×</button></div><p>{previews.length ? "Everything found in the report is listed below. Select whole content groups or open any group to choose individual pulls." : "Paste one or more normal Warcraft Logs report links. The app reads the contents first; nothing is saved until you approve the exact pulls."}</p><form onSubmit={onReview}><label>Full report URL<textarea autoFocus value={reportUrls} onChange={(event) => onUrlsChange(event.target.value)} placeholder={"https://www.warcraftlogs.com/reports/ABC12345"} required /></label><div className="import-path"><span>Paste link</span><b>→</b><span>Read contents</span><b>→</b><span>Choose pulls</span><b>→</b><span>Confirm import</span></div>{previews.length === 0 && <button className="primary-button" disabled={busy} type="submit">{busy ? "Reading report…" : "Read report contents"}</button>}{status && <p className="form-status" role="status">{status}</p>}</form>{previews.length > 0 && <div className="selective-import-review">{previews.map((preview) => <article className="selective-report" key={preview.code}><div className="import-review-heading"><div><small>{preview.raid} · {new Date(preview.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small><strong>{preview.title}</strong></div><span>{preview.visibility}</span></div><div className="import-review-totals"><span><strong>{preview.pullCount}</strong><small>Encounters found</small></span><span><strong>{selections[preview.code]?.length ?? 0}</strong><small>Selected pulls</small></span><span><strong>{preview.playerCount}</strong><small>Unique players</small></span></div><div className="content-group-list">{preview.groups.map((group) => { const selectedIds = selections[preview.code] ?? []; const selectedInGroup = group.fights.filter((fight) => selectedIds.includes(fight.id)).length; const allSelected = selectedInGroup === group.fights.length; return <section className={`content-group content-${group.kind}`} key={group.id}><div className="content-group-heading"><label><input checked={allSelected} onChange={() => onToggleGroup(preview.code, group, !allSelected)} type="checkbox" /><span><strong>{group.label}</strong><small>{group.description}</small></span></label><span className={`content-kind content-kind-${group.kind}`}>{group.kind === "mythic_plus" ? "M+" : group.kind === "raid" ? "Raid" : "Other"}</span><span className="selection-count">{selectedInGroup}/{group.fights.length} selected</span></div><details><summary>Choose individual pulls</summary><div className="pull-selection-list">{group.fights.map((fight) => <label className="pull-selection" key={fight.id}><input checked={selectedIds.includes(fight.id)} onChange={() => onToggleFight(preview.code, fight.id)} type="checkbox" /><span><strong>{group.kind === "mythic_plus" ? fight.name : `Pull ${fight.pullNumber}`}</strong><small>{fight.difficulty} · {fight.duration} · {fight.playerCount} players</small></span><b>{fight.result}</b></label>)}</div></details></section>; })}</div></article>)}<div className="selection-summary"><span><strong>{selectedCount}</strong> selected</span><span><strong>{excludedCount}</strong> excluded</span><p>Only the selected pulls will be written to the raid analysis database.</p></div><button className="primary-button confirm-import" disabled={busy || selectedCount === 0} onClick={onConfirm} type="button">{busy ? "Importing selected pulls…" : `Import ${selectedCount} selected pull${selectedCount === 1 ? "" : "s"}`}</button><button className="review-again" disabled={busy} onClick={onReset} type="button">Use a different link</button></div>}<small className="credential-note">Trash is omitted automatically. Raid encounters start selected; Mythic+ and unclassified encounters start unchecked.</small></section></div>;
}

function RosterManager({ members, busy, status, onToggle }: { members: RosterMember[]; busy: boolean; status: string; onToggle: (member: RosterMember) => void }) {
  const activeCount = members.filter((member) => member.included).length;
  const ignoredCount = members.length - activeCount;
  return <article className="panel roster-manager"><div className="roster-manager-heading"><div><p className="eyebrow muted"><span /> Raid roster</p><h2>Choose who belongs in the analysis</h2><p>Keep regular raiders active. Ignore pugs so they disappear from dashboards, officer comparisons, private reports, and raid averages. Their original log data stays available if you restore them later.</p></div><div className="roster-counts"><span><strong>{activeCount}</strong><small>Active</small></span><span className="ignored"><strong>{ignoredCount}</strong><small>Ignored</small></span></div></div>{status && <p className="roster-status" role="status">{status}</p>}<div className="roster-list" role="list">{[...members].sort((a, b) => Number(b.included) - Number(a.included) || a.name.localeCompare(b.name)).map((member) => <div className={`roster-member ${member.included ? "" : "roster-member-ignored"}`} key={member.id} role="listitem"><span className="roster-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div className="roster-identity"><strong>{member.name}</strong><small>{member.spec} {member.className}{member.realm ? ` · ${member.realm}` : ""}</small></div><span className="roster-role">{member.role}</span><span className="roster-history"><strong>{member.pullsSeen}</strong><small>pull{member.pullsSeen === 1 ? "" : "s"} · {member.raidNights} night{member.raidNights === 1 ? "" : "s"}</small></span><span className={`roster-state ${member.included ? "included" : "excluded"}`}>{member.included ? "Active" : "Ignored"}</span><button aria-label={`${member.included ? "Ignore" : "Restore"} ${member.name}`} disabled={busy} onClick={() => onToggle(member)} type="button">{member.included ? "Ignore guest" : "Restore"}</button></div>)}</div></article>;
}

export function RaidApp({ initialData: fallbackData }: { initialData: DashboardData }) {
  const [initialData, setInitialData] = useState(fallbackData);
  const [view, setView] = useState<View>("player");
  const [activeScore, setActiveScore] = useState<ScoreKey | null>(null);
  const [playerId, setPlayerId] = useState(initialData.players[0].id);
  const [bossId, setBossId] = useState(initialData.bosses[0].id);
  const [pullId, setPullId] = useState(initialData.pulls[0].id);
  const [rules, setRules] = useState(initialData.rules);
  const [importOpen, setImportOpen] = useState(false);
  const [reportUrls, setReportUrls] = useState("");
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([]);
  const [importSelections, setImportSelections] = useState<Record<string, number[]>>({});
  const [importStatus, setImportStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [ruleStatus, setRuleStatus] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function applyDashboard(nextData: DashboardData) {
    const nextBossId = nextData.bosses.some((candidate) => candidate.id === bossId) ? bossId : nextData.bosses[0].id;
    const nextPullId = nextData.pulls.some((candidate) => candidate.id === pullId) ? pullId : nextData.pulls.find((candidate) => candidate.bossId === nextBossId)?.id ?? nextData.pulls[0].id;
    const nextPlayers = nextData.pullPlayers?.[nextPullId] ?? nextData.players;
    setInitialData(nextData);
    setBossId(nextBossId);
    setPullId(nextPullId);
    setPlayerId(nextPlayers.some((candidate) => candidate.id === playerId) ? playerId : nextPlayers[0].id);
    setRules(nextData.rules);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard")
      .then(async (response) => response.ok ? response.json() as Promise<{ data: DashboardData }> : null)
      .then((result) => {
        if (!active || !result?.data?.pulls?.length || !result.data.players?.length) return;
        setInitialData(result.data);
        setPlayerId(result.data.players[0].id);
        setBossId(result.data.bosses[0].id);
        setPullId(result.data.pulls[0].id);
        setRules(result.data.rules);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const boss = initialData.bosses.find((candidate) => candidate.id === bossId) ?? initialData.bosses[0];
  const pullOptions = initialData.pulls.filter((pull) => pull.bossId === bossId);
  const pull = pullOptions.find((candidate) => candidate.id === pullId) ?? pullOptions[0];
  const activePlayers = initialData.pullPlayers?.[pull?.id ?? pullId] ?? initialData.players;
  const rosterMembers = initialData.roster ?? initialData.players.map((candidate) => ({ id: candidate.id, name: candidate.name, realm: candidate.realm, className: candidate.className, spec: candidate.spec, role: candidate.role, pullsSeen: initialData.pulls.length, raidNights: 1, lastSeen: null, included: true }));
  const player = activePlayers.find((candidate) => candidate.id === playerId) ?? activePlayers[0] ?? initialData.players[0];
  const activeEvents = initialData.pullEvents?.[pull?.id ?? pullId] ?? initialData.events;
  const playerEvents = activeEvents.filter((event) => event.playerId === player.id);
  const findings = playerEvents.filter((event) => event.kind === "warning" || event.kind === "death").length;
  const mechanicsScore = player.scores.mechanics;
  const matchedRules = rules.filter((rule) => playerEvents.some((event) => event.spellId === rule.spellId));

  const officerSummary = useMemo(() => {
    const average = (key: ScoreKey) => {
      const values = activePlayers.map((candidate) => candidate.scores[key]).filter((value): value is number => value !== null);
      return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
    };
    return { mechanics: average("mechanics"), performance: average("performance"), attendance: average("attendance"), preparation: average("preparation") };
  }, [activePlayers]);

  function chooseBoss(nextBoss: string) {
    setBossId(nextBoss);
    setPullId(initialData.pulls.find((candidate) => candidate.bossId === nextBoss)?.id ?? initialData.pulls[0].id);
  }

  async function previewReports(event: FormEvent) {
    event.preventDefault(); setBusy(true); setImportStatus("Reading every encounter in the report…"); setImportPreviews([]); setImportSelections({});
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", urls: reportUrls, season: initialData.season }) });
      const result = await response.json() as { error?: string; reports?: ImportPreview[]; needsConnection?: boolean };
      if (!response.ok) throw new Error(result.needsConnection ? "The one-time Warcraft Logs connection still needs to be completed before the first import." : result.error ?? "Preview failed.");
      const reports = result.reports ?? [];
      setImportPreviews(reports);
      setImportSelections(Object.fromEntries(reports.map((report) => [report.code, report.groups.filter((group) => group.defaultSelected).flatMap((group) => group.fights.map((fight) => fight.id))])));
      setImportStatus("Choose the content groups and individual pulls you want. Nothing has been saved yet.");
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The report could not be imported."); }
    finally { setBusy(false); }
  }

  async function confirmImport() {
    const selections = importPreviews.map((preview) => ({ code: preview.code, fightIds: importSelections[preview.code] ?? [] }));
    if (!selections.some((selection) => selection.fightIds.length)) { setImportStatus("Select at least one pull to import."); return; }
    setBusy(true); setImportStatus("Importing only the selected pulls and applying active rules…");
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", urls: reportUrls, season: initialData.season, selections }) });
      const result = await response.json() as { error?: string; reports?: { status: string; pulls?: number; bosses?: number }[] };
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      const stored = result.reports ?? [];
      const pulls = stored.reduce((total, report) => total + (report.pulls ?? 0), 0);
      const bosses = stored.reduce((total, report) => total + (report.bosses ?? 0), 0);
      setImportStatus(pulls ? `${pulls} pulls across ${bosses} bosses imported. Opening the new raid dashboard…` : "This report was already imported. Opening its dashboard…");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The report could not be imported."); }
    finally { setBusy(false); }
  }

  function toggleImportGroup(code: string, group: ImportGroup, selected: boolean) {
    setImportSelections((current) => {
      const next = new Set(current[code] ?? []);
      group.fights.forEach((fight) => selected ? next.add(fight.id) : next.delete(fight.id));
      return { ...current, [code]: [...next] };
    });
  }

  function toggleImportFight(code: string, fightId: number) {
    setImportSelections((current) => {
      const next = new Set(current[code] ?? []);
      if (next.has(fightId)) next.delete(fightId); else next.add(fightId);
      return { ...current, [code]: [...next] };
    });
  }

  function resetImportReview() {
    setImportPreviews([]);
    setImportSelections({});
    setImportStatus("");
  }

  async function createShare() {
    setBusy(true); setShareStatus("Creating a player-only link…");
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: player.id, bossId, pullId: pull?.id }) });
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

  async function updateRoster(member: RosterMember) {
    const included = !member.included;
    setBusy(true);
    setRosterStatus(`${included ? "Restoring" : "Ignoring"} ${member.name}…`);
    try {
      const response = await fetch("/api/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: member.id, included }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The roster could not be updated.");
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData; error?: string };
      if (!dashboardResponse.ok || !dashboardResult.data) throw new Error(dashboardResult.error ?? "The refreshed roster could not be loaded.");
      applyDashboard(dashboardResult.data);
      setRosterStatus(included ? `${member.name} is active again and included everywhere.` : `${member.name} is now ignored across dashboards, comparisons, averages, and sharing.`);
    } catch (error) { setRosterStatus(error instanceof Error ? error.message : "The roster could not be updated."); }
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
        <div className="hero-row"><div><h1>{mechanicsScore === null ? "Ready for calibration" : mechanicsScore >= 90 ? "Good pull" : mechanicsScore >= 80 ? "Solid pull" : "Clear next step"}, {player.name}.</h1><p>{player.summary}</p></div><div className="context-chip"><span>{pull?.difficulty}</span><strong>{pull?.duration}</strong><small>{pull?.killed ? "Kill" : "Wipe"}</small></div></div>
        {initialData.dataSource && <div className="status-line data-source-line"><span /><a href={initialData.dataSource.reportUrl} target="_blank" rel="noreferrer">{initialData.dataSource.detail}</a>{initialData.dataSource.wipefestUrl && <a href={initialData.dataSource.wipefestUrl} target="_blank" rel="noreferrer">Open Wipefest</a>}</div>}
        {shareStatus && <div className="status-line" role="status"><span />{shareStatus}</div>}
        <div className="filters" aria-label="Dashboard filters">
          <label>Player<select value={player.id} onChange={(event) => setPlayerId(event.target.value)}>{activePlayers.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.spec} {candidate.className}</option>)}</select></label>
          <label>Boss<select value={bossId} onChange={(event) => chooseBoss(event.target.value)}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
          <label>Pull<select value={pull?.id} onChange={(event) => setPullId(event.target.value)}>{pullOptions.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label>
          <p><span className="live-dot" /> {boss.name} · {rules.filter((rule) => rule.bossId === boss.id).length} active rules · {pullOptions.length} pulls</p>
        </div>
        <section className="score-grid" aria-label="Player scores">
          {scoreKeys.map((key, index) => {
            const value = player.scores[key];
            const average = officerSummary[key];
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
            <div className="score-detail-stats"><span><small>Player score</small><strong>{player.scores.mechanics ?? "N/A"}</strong><em>{initialData.dataSource?.label === "Live Warcraft Logs import" ? "Configured rules" : "Wipefest"}</em></span><span><small>Raid average</small><strong>{officerSummary.mechanics ?? "N/A"}</strong><em>{activePlayers.length} players</em></span><span><small>Timeline findings</small><strong>{playerEvents.length}</strong><em>{findings} need review</em></span><span><small>Matched rules</small><strong>{matchedRules.length}</strong><em>Spell-ID based</em></span></div>
            <div className="score-detail-columns"><div><h3>Events from this pull</h3><ul className="events detail-event-list">{playerEvents.map((event) => <li key={`detail-${event.id}`}><span className={`event-status ${event.kind}`}>{event.kind === "warning" || event.kind === "death" ? "!" : "✓"}</span><div><strong>{event.ability}</strong><small>{event.detail}</small></div><time>{event.timestamp}</time></li>)}</ul></div><div><h3>Rules that matched</h3><div className="detail-rule-list">{matchedRules.map((rule) => <div key={`detail-${rule.id}`}><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span><p><strong>{rule.name}</strong><small>Spell {rule.spellId} · weight {rule.weight}</small></p></div>)}{matchedRules.length === 0 && <p className="detail-empty">No configured rule matched this player&apos;s displayed timeline events.</p>}</div></div></div>
          </>}
          {activeScore === "performance" && <><div className="score-detail-stats"><span><small>WCL parse</small><strong>{player.parse ?? "N/A"}</strong><em>{player.role === "Healer" ? "Healing" : "Damage"}</em></span><span><small>Item-level parse</small><strong>{player.ilvlParse ?? "N/A"}</strong><em>Item level {player.itemLevel ?? "—"}</em></span><span><small>Performance</small><strong>{player.scores.performance ?? "N/A"}</strong><em>Transparent blend</em></span><span><small>Active pull</small><strong>{pull?.duration}</strong><em>{pull?.label}</em></span></div><div className="detail-explanation"><strong>The current formula</strong><p>Performance = 65% Warcraft Logs parse + 35% item-level parse. It keeps raw output visible while adding context for the gear available to the player. This score does not affect Mechanics, Attendance, or Preparation.</p></div></>}
          {activeScore === "attendance" && <><div className="score-detail-stats"><span><small>Tracked nights</small><strong>1/1</strong><em>{initialData.raidNight}</em></span><span><small>Pull presence</small><strong>Yes</strong><em>Selected pull</em></span><span><small>Attendance</small><strong>{player.scores.attendance ?? "N/A"}</strong><em>First baseline</em></span><span><small>Trend confidence</small><strong>Low</strong><em>More nights needed</em></span></div><div className="detail-explanation"><strong>Why this is 100 today</strong><p>{player.name} was present for this imported raid night. This becomes a meaningful percentage after additional scheduled nights are imported.</p></div></>}
          {activeScore === "preparation" && <><div className="score-detail-stats"><span><small>Individual score</small><strong>{player.scores.preparation ?? "N/A"}</strong><em>Not assumed</em></span><span><small>Raid flasks</small><strong>{initialData.preparationRaid?.flasks ?? "N/A"}{initialData.preparationRaid?.flasks !== null && initialData.preparationRaid?.flasks !== undefined && initialData.preparationRaid.total ? `/${initialData.preparationRaid.total}` : ""}</strong><em>Available source</em></span><span><small>Raid food</small><strong>{initialData.preparationRaid?.food ?? "N/A"}{initialData.preparationRaid?.food !== null && initialData.preparationRaid?.food !== undefined && initialData.preparationRaid.total ? `/${initialData.preparationRaid.total}` : ""}</strong><em>Available source</em></span><span><small>Player penalty</small><strong>None</strong><em>No guessing</em></span></div><div className="detail-explanation"><strong>What we know</strong><p>{initialData.preparationSummary} The app intentionally leaves this player score blank rather than assigning incomplete raid data to an individual.</p></div></>}
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
        <article className="panel roster-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Roster comparison</p><h2>{boss.name} · {pull?.label}</h2></div><div className="legend"><span><i className="good-dot" /> 90+</span><span><i className="watch-dot" /> Below 80</span></div></div><div className="table-scroll"><table><thead><tr><th>Player</th><th>Role</th><th>Mechanics</th><th>Performance</th><th>Attendance</th><th>Preparation</th><th>Review</th></tr></thead><tbody>{[...activePlayers].sort((a, b) => (b.scores.mechanics ?? -1) - (a.scores.mechanics ?? -1)).map((candidate) => { const needsReview = scoreKeys.some((key) => candidate.scores[key] !== null && candidate.scores[key] < 80); return <tr key={candidate.id}><td><button className="player-cell" type="button" onClick={() => { setPlayerId(candidate.id); setView("player"); }}><span>{candidate.name.slice(0, 2).toUpperCase()}</span><strong>{candidate.name}<small>{candidate.spec} {candidate.className}</small></strong></button></td><td>{candidate.role}</td>{scoreKeys.map((key) => { const value = candidate.scores[key]; return <td key={key}><span className={`table-score ${value !== null && value >= 90 ? "high" : value !== null && value < 80 ? "low" : ""}`}>{value ?? "—"}</span></td>; })}<td><span className={`review-chip ${needsReview ? "attention" : "clear"}`}>{needsReview ? "Needs context" : "Clear"}</span></td></tr>; })}</tbody></table></div></article>
        <div className="officer-footnote"><strong>Privacy by workflow</strong><span>Officers compare the full roster here. Player links are generated separately and include only one player plus anonymous averages.</span></div>
      </section>}

      {view === "configure" && <section className="dashboard config-view" id="configure">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Encounter configuration</p><button className="share-button" type="button" onClick={() => setImportOpen(true)}>Import reports</button></div>
        <div className="section-hero"><div><h1>Define what matters once.</h1><p>The engine stays the same. Each raid tier is maintained here as a set of readable, editable mechanic rules.</p></div><div className="engine-note"><span>Configuration</span><b>→</b><span>Analysis engine</span><b>→</b><span>Four scores</span></div></div>
        <RosterManager members={rosterMembers} busy={busy} status={rosterStatus} onToggle={updateRoster} />
        <div className="config-filters"><label>Raid<select defaultValue={initialData.raid}><option>{initialData.raid}</option></select></label><label>Boss<select value={bossId} onChange={(event) => chooseBoss(event.target.value)}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label><div><span>Active rules</span><strong>{rules.filter((rule) => rule.bossId === bossId).length}</strong></div></div>
        <section className="config-grid">
          <article className="panel rules-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Rule library</p><h2>{boss.name}</h2></div><span className="confidence">Config-driven</span></div><div className="rule-list">{rules.filter((rule) => rule.bossId === bossId).map((rule) => <div className="rule-row" key={rule.id}><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span><div><strong>{rule.name}</strong><small>Spell {rule.spellId} · {rule.category}</small><p>{rule.roles.join(", ")} · {rule.difficulties.join(", ")}{rule.condition.note ? ` · ${rule.condition.note}` : ""}</p></div><b>−{rule.weight}</b></div>)}{!rules.some((rule) => rule.bossId === bossId) && <div className="empty-rules">No rules for this boss yet. Add the first one beside this list.</div>}</div></article>
          <form className="panel rule-form" onSubmit={addRule}><p className="eyebrow"><span /> New mechanic rule</p><h2>Teach the analyzer</h2><div className="form-pair"><label>Mechanic name<input name="name" placeholder="e.g. Gilded Wave" required /></label><label>Spell ID<input name="spellId" inputMode="numeric" placeholder="451117" required /></label></div><div className="form-pair"><label>Category<select name="category" defaultValue="Avoidable damage"><option>Avoidable damage</option><option>Mechanic failure</option><option>Interrupt</option><option>Dispel</option><option>Defensive</option><option>Soak</option><option>Utility</option></select></label><label>Event type<select name="eventType" defaultValue="damage"><option>damage</option><option>debuff</option><option>cast</option><option>interrupt</option><option>dispel</option><option>death</option></select></label></div><div className="form-pair"><label>Severity<select name="severity" defaultValue="Medium"><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label><label>Penalty weight<input name="weight" inputMode="decimal" defaultValue="4" required /></label></div><fieldset><legend>Applies on</legend><label><input name="difficulty" type="checkbox" value="Normal" /> Normal</label><label><input name="difficulty" type="checkbox" value="Heroic" defaultChecked /> Heroic</label><label><input name="difficulty" type="checkbox" value="Mythic" defaultChecked /> Mythic</label></fieldset><fieldset><legend>Roles</legend><label><input name="role" type="checkbox" value="Tank" defaultChecked /> Tanks</label><label><input name="role" type="checkbox" value="Healer" defaultChecked /> Healers</label><label><input name="role" type="checkbox" value="DPS" defaultChecked /> DPS</label></fieldset><details><summary>Optional conditions</summary><label>Minimum amount<input name="minAmount" inputMode="numeric" placeholder="50000" /></label><label className="checkline"><input name="countOnce" type="checkbox" /> Count once per cast</label><label className="checkline"><input name="ignoreTanks" type="checkbox" /> Ignore tanks</label><label>Rule note<textarea name="note" placeholder="Ignore the first unavoidable tick…" /></label></details><button className="primary-button" disabled={busy} type="submit">Save mechanic rule</button>{ruleStatus && <p className="form-status" role="status">{ruleStatus}</p>}</form>
        </section>
      </section>}

      {importOpen && <ImportModal
        reportUrls={reportUrls}
        previews={importPreviews}
        selections={importSelections}
        busy={busy}
        status={importStatus}
        onClose={() => setImportOpen(false)}
        onUrlsChange={(value) => { setReportUrls(value); resetImportReview(); }}
        onReview={previewReports}
        onConfirm={confirmImport}
        onToggleGroup={toggleImportGroup}
        onToggleFight={toggleImportFight}
        onReset={resetImportReview}
      />}
    </main>
  );
}
