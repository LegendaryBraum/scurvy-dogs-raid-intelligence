"use client";

/* eslint-disable @next/next/no-img-element, jsx-a11y/label-has-associated-control, jsx-a11y/no-autofocus, jsx-a11y/no-noninteractive-element-interactions */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AccessWorkspace, DashboardData, MechanicRule, ModuleSettings, PlayerHistoryPoint, PlayerSnapshot, RaidEvent, RaidNightRecord, RaidReportRecord, RosterMember, ScoreKey } from "../../lib/types";

type View = "home" | "player" | "officer" | "configure";
type ConfigureSection = "raid-data" | "people" | "scoring" | "access";
type ImportFight = { id: number; name: string; pullNumber: number; difficulty: string; duration: string; result: string; playerCount: number };
type ImportGroup = { id: string; label: string; description: string; kind: "raid" | "mythic_plus" | "other"; defaultSelected: boolean; fights: ImportFight[] };
type ImportPreview = { code: string; title: string; raid: string; visibility: string; startedAt: number; pullCount: number; playerCount: number; bosses: { name: string; pulls: number; kills: number }[]; groups: ImportGroup[] };
type WclAllowance = { state: "checking" | "ready" | "low" | "full" | "unavailable"; percentRemaining?: number; pointsResetIn?: number; error?: string };
type ImportJob = { id: string; reportCode: string; reportUrl: string; status: "queued" | "processing" | "paused" | "failed" | "completed"; totalPulls: number; completedPulls: number; currentLabel?: string | null; error?: string | null; retryAfterSeconds?: number; resumeAfter?: string | null; createdAt: string; completedAt?: string | null };
const scoreLabels: Record<ScoreKey, string> = { mechanics: "Mechanics", performance: "Performance", attendance: "Attendance", preparation: "Preparation" };
const scoreKeys: ScoreKey[] = ["mechanics", "performance", "attendance", "preparation"];
const defaultModuleSettings: ModuleSettings = { mechanics: true, performance: true, attendance: true, preparation: false };
const moduleDescriptions: Record<ScoreKey, string> = {
  mechanics: "Encounter rules, timeline findings, mechanic scores, and trends.",
  performance: "Warcraft Logs damage or healing parses with item-level context.",
  attendance: "Raid-night attendance grouped by raider identity, including linked alternate characters.",
  preparation: "Flasks, food, enchants, gems, and potion checks when the season is ready for them.",
};

function resetInLabel(seconds?: number) {
  if (!seconds || seconds <= 0) return "Reset time unavailable";
  if (seconds < 60) return `Resets in ${seconds} sec`;
  return `Resets in ${Math.ceil(seconds / 60)} min`;
}

function ImportModal({ reportUrls, previews, selections, jobs, allowance, busy, status, onClose, onUrlsChange, onReview, onConfirm, onResume, onCancel, onToggleGroup, onToggleFight, onReset }: { reportUrls: string; previews: ImportPreview[]; selections: Record<string, number[]>; jobs: ImportJob[]; allowance: WclAllowance; busy: boolean; status: string; onClose: () => void; onUrlsChange: (value: string) => void; onReview: (event: FormEvent) => void; onConfirm: () => void; onResume: () => void; onCancel: (job: ImportJob) => void; onToggleGroup: (code: string, group: ImportGroup, selected: boolean) => void; onToggleFight: (code: string, fightId: number) => void; onReset: () => void }) {
  const selectedCount = Object.values(selections).reduce((total, ids) => total + ids.length, 0);
  const foundCount = previews.reduce((total, preview) => total + preview.pullCount, 0);
  const excludedCount = Math.max(0, foundCount - selectedCount);
  const activeJobs = jobs.filter((job) => job.status !== "completed");
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="import-modal selective-import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-heading"><div><p className="eyebrow"><span /> Warcraft Logs import</p><h2 id="import-title">{activeJobs.length ? "Your import is safely checkpointed" : previews.length ? "Choose exactly what to import" : "Review the full run before importing"}</h2></div><button type="button" onClick={onClose} aria-label="Close import">×</button></div>
    {activeJobs.length > 0 ? <div className="import-job-workspace">
      <p>Each pull is saved as a checkpoint. You can close this window or leave the site; unfinished work will still be here when you return.</p>
      <div className="import-job-list">{jobs.map((job) => {
        const percent = job.totalPulls ? Math.round(job.completedPulls / job.totalPulls * 100) : 0;
        const stateLabel = job.status === "paused" ? "Paused safely" : job.status === "failed" ? "Needs attention" : job.status === "completed" ? "Complete" : job.status === "processing" ? "Analyzing now" : "Ready";
        return <article className={`import-job import-job-${job.status}`} key={job.id}>
          <div className="import-job-heading"><div><strong>{job.reportCode}</strong><small>{job.currentLabel ?? "Waiting to continue"}</small></div><span>{stateLabel}</span></div>
          <div className="import-progress" aria-label={`${job.completedPulls} of ${job.totalPulls} pulls analyzed`}><i style={{ width: `${percent}%` }} /></div>
          <div className="import-job-meta"><span><strong>{job.completedPulls}</strong> of <strong>{job.totalPulls}</strong> pulls analyzed</span><span>{percent}%</span></div>
          {job.error && <p className="import-job-error">{job.error}</p>}
          <div className="import-job-actions">{job.status !== "completed" && <button className="danger-text" disabled={busy} onClick={() => onCancel(job)} type="button">Remove unfinished import</button>}</div>
        </article>;
      })}</div>
      {status && <p className="form-status" role="status">{status}</p>}
      <button className="primary-button resume-import" disabled={busy} onClick={onResume} type="button">{busy ? "Analyzing the next pull…" : activeJobs.some((job) => job.status === "paused") ? "Try resume now" : activeJobs.some((job) => job.status === "failed") ? "Retry from last checkpoint" : "Continue import"}</button>
      <small className="credential-note">Nothing staged here appears in player dashboards, attendance, or officer comparisons until every selected pull is complete.</small>
    </div> : <>
      <p>{previews.length ? "Everything found in the report is listed below. Select whole content groups or open any group to choose individual pulls." : "Paste one or more normal Warcraft Logs report links. The app reads the contents first; nothing is saved until you approve the exact pulls."}</p>
      <form onSubmit={onReview}><label>Full report URL<textarea autoFocus value={reportUrls} onChange={(event) => onUrlsChange(event.target.value)} placeholder={"https://www.warcraftlogs.com/reports/ABC12345"} required /></label><div className="import-path"><span>Paste link</span><b>→</b><span>Read contents</span><b>→</b><span>Choose pulls</span><b>→</b><span>Confirm import</span></div>{previews.length === 0 && <div className="import-action-row"><button className="primary-button" disabled={busy || allowance.state === "full"} type="submit">{busy ? "Reading report…" : allowance.state === "full" ? "Waiting for Warcraft Logs" : "Read report contents"}</button><div aria-live="polite" className={`api-allowance allowance-${allowance.state}`}><i /><span><strong>{allowance.state === "checking" ? "Checking allowance" : allowance.state === "ready" ? "Warcraft Logs ready" : allowance.state === "low" ? "Allowance getting low" : allowance.state === "full" ? "Hourly allowance full" : "Allowance unavailable"}</strong><small>{allowance.state === "checking" ? "Reading the shared API meter…" : allowance.state === "ready" || allowance.state === "low" ? `${allowance.percentRemaining ?? 0}% available · ${resetInLabel(allowance.pointsResetIn)}` : allowance.state === "full" ? resetInLabel(allowance.pointsResetIn) : "You can still try the import"}</small></span></div></div>}{status && <p className="form-status" role="status">{status}</p>}</form>
      {previews.length > 0 && <div className="selective-import-review">{previews.map((preview) => <article className="selective-report" key={preview.code}><div className="import-review-heading"><div><small>{preview.raid} · {new Date(preview.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small><strong>{preview.title}</strong></div><span>{preview.visibility}</span></div><div className="import-review-totals"><span><strong>{preview.pullCount}</strong><small>Encounters found</small></span><span><strong>{selections[preview.code]?.length ?? 0}</strong><small>Selected pulls</small></span><span><strong>{preview.playerCount}</strong><small>Unique players</small></span></div><div className="content-group-list">{preview.groups.map((group) => { const selectedIds = selections[preview.code] ?? []; const selectedInGroup = group.fights.filter((fight) => selectedIds.includes(fight.id)).length; const allSelected = selectedInGroup === group.fights.length; return <section className={`content-group content-${group.kind}`} key={group.id}><div className="content-group-heading"><label><input checked={allSelected} onChange={() => onToggleGroup(preview.code, group, !allSelected)} type="checkbox" /><span><strong>{group.label}</strong><small>{group.description}</small></span></label><span className={`content-kind content-kind-${group.kind}`}>{group.kind === "mythic_plus" ? "M+" : group.kind === "raid" ? "Raid" : "Other"}</span><span className="selection-count">{selectedInGroup}/{group.fights.length} selected</span></div><details><summary>Choose individual pulls</summary><div className="pull-selection-list">{group.fights.map((fight) => <label className="pull-selection" key={fight.id}><input checked={selectedIds.includes(fight.id)} onChange={() => onToggleFight(preview.code, fight.id)} type="checkbox" /><span><strong>{group.kind === "mythic_plus" ? fight.name : `Pull ${fight.pullNumber}`}</strong><small>{fight.difficulty} · {fight.duration} · {fight.playerCount} players</small></span><b>{fight.result}</b></label>)}</div></details></section>; })}</div></article>)}<div className="selection-summary"><span><strong>{selectedCount}</strong> selected</span><span><strong>{excludedCount}</strong> excluded</span><p>Only the selected pulls will be written to the raid analysis database.</p></div><button className="primary-button confirm-import" disabled={busy || selectedCount === 0} onClick={onConfirm} type="button">{busy ? "Creating safe import…" : `Import ${selectedCount} selected pull${selectedCount === 1 ? "" : "s"}`}</button><button className="review-again" disabled={busy} onClick={onReset} type="button">Use a different link</button></div>}
      <small className="credential-note">Trash is omitted automatically. Raid encounters start selected; Mythic+ and unclassified encounters start unchecked.</small>
    </>}
  </section></div>;
}

function RosterManager({ members, busy, status, onToggle }: { members: RosterMember[]; busy: boolean; status: string; onToggle: (member: RosterMember) => void }) {
  const activeCount = members.filter((member) => member.included).length;
  const ignoredCount = members.length - activeCount;
  return <article className="panel roster-manager"><div className="roster-manager-heading"><div><p className="eyebrow muted"><span /> Raid roster</p><h2>Choose who belongs in the analysis</h2><p>Keep regular raiders active. Ignore pugs so they disappear from dashboards, officer comparisons, private reports, and raid averages. Their original log data stays available if you restore them later.</p></div><div className="roster-counts"><span><strong>{activeCount}</strong><small>Active</small></span><span className="ignored"><strong>{ignoredCount}</strong><small>Ignored</small></span></div></div>{status && <p className="roster-status" role="status">{status}</p>}<div className="roster-list" role="list">{[...members].sort((a, b) => Number(b.included) - Number(a.included) || a.name.localeCompare(b.name)).map((member) => <div className={`roster-member ${member.included ? "" : "roster-member-ignored"}`} key={member.id} role="listitem"><span className="roster-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div className="roster-identity"><strong>{member.name}</strong><small>{member.spec} {member.className}{member.realm ? ` · ${member.realm}` : ""}</small></div><span className="roster-role">{member.role}</span><span className="roster-history"><strong>{member.pullsSeen}</strong><small>pull{member.pullsSeen === 1 ? "" : "s"} · {member.raidNights} night{member.raidNights === 1 ? "" : "s"}</small></span><span className={`roster-state ${member.included ? "included" : "excluded"}`}>{member.included ? "Active" : "Ignored"}</span><button aria-label={`${member.included ? "Ignore" : "Restore"} ${member.name}`} disabled={busy} onClick={() => onToggle(member)} type="button">{member.included ? "Ignore guest" : "Restore"}</button></div>)}</div></article>;
}

function ModuleManager({ settings, busy, status, onToggle }: { settings: ModuleSettings; busy: boolean; status: string; onToggle: (key: ScoreKey) => void }) {
  const activeCount = scoreKeys.filter((key) => settings[key]).length;
  return <article className="panel module-manager"><div className="module-manager-heading"><div><p className="eyebrow muted"><span /> Score modules</p><h2>Use only what matters right now</h2><p>Pause any module without deleting its data. Turning it back on restores it across player dashboards, officer comparisons, and private reports.</p></div><div className="module-count"><strong>{activeCount}</strong><small>Active</small></div></div>{status && <p className="roster-status" role="status">{status}</p>}<div className="module-list">{scoreKeys.map((key) => <div className={`module-row ${settings[key] ? "" : "module-row-paused"}`} key={key}><div><strong>{scoreLabels[key]}</strong><p>{moduleDescriptions[key]}</p></div><span className={`module-state ${settings[key] ? "active" : "paused"}`}>{settings[key] ? "Active" : "Paused"}</span><button aria-pressed={settings[key]} disabled={busy} onClick={() => onToggle(key)} type="button">{settings[key] ? "Pause module" : "Turn on"}</button></div>)}</div></article>;
}

function RaidNightManager({ raidNights, busy, status, onToggle, onDelete, onReplace, onAdd }: { raidNights: RaidNightRecord[]; busy: boolean; status: string; onToggle: (target: "raid_night" | "report" | "pull", id: string, included: boolean) => void; onDelete: (target: "raid_night" | "report", id: string, label: string) => void; onReplace: (report: RaidReportRecord) => void; onAdd: (night: RaidNightRecord) => void }) {
  const active = raidNights.filter((night) => night.included).length;
  return <article className="panel run-manager">
    <div className="run-manager-heading"><div><p className="eyebrow muted"><span /> Raid nights, reports & pulls</p><h2>Keep the season history clean</h2><p>Open any report to exclude individual pulls without deleting them. Whole nights and reports remain reversible too.</p></div><div className="module-count"><strong>{active}</strong><small>Active nights</small></div></div>
    {status && <p className="roster-status" role="status">{status}</p>}
    <div className="raid-night-list">{raidNights.map((night) => <section className={`raid-night-card ${night.included ? "" : "run-archived"}`} key={night.id}>
      <div className="raid-night-heading"><div><span className="run-date">{new Date(night.happenedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span><strong>{night.name}</strong><small>{night.reportCount} report{night.reportCount === 1 ? "" : "s"} · {night.activePullCount}/{night.pullCount} active pulls</small></div><span className={`run-state ${night.included ? "active" : "archived"}`}>{night.included ? "Active" : "Excluded"}</span><div className="run-actions"><button disabled={busy} onClick={() => onAdd(night)} type="button">Add report</button><button disabled={busy} onClick={() => onToggle("raid_night", night.id, !night.included)} type="button">{night.included ? "Exclude night" : "Restore night"}</button><button className="danger-text" disabled={busy} onClick={() => onDelete("raid_night", night.id, night.name)} type="button">Delete</button></div></div>
      <div className="saved-report-list">{night.reports.map((report) => <section className={`saved-report ${report.included ? "" : "run-archived"}`} key={report.id}>
        <div className="saved-report-summary"><div><strong>{report.title}</strong><small>{report.zoneName} · {report.pullCount} pulls · {report.bossCount} bosses · {report.playerCount} players</small><a href={report.url} rel="noreferrer" target="_blank">{report.code}</a></div><span className={`run-state ${report.included ? "active" : "archived"}`}>{report.included ? "Included" : "Excluded"}</span><div className="run-actions"><button disabled={busy} onClick={() => onReplace(report)} type="button">Replace / reimport</button><button disabled={busy || !night.included} onClick={() => onToggle("report", report.id, !report.included)} type="button">{report.included ? "Exclude" : "Restore"}</button><button className="danger-text" disabled={busy} onClick={() => onDelete("report", report.id, report.title)} type="button">Delete</button></div></div>
        <details className="saved-pull-review"><summary><span>Review individual pulls</span><small>{report.pulls.filter((pull) => pull.included).length}/{report.pullCount} selected</small></summary><div className="saved-pull-list">{report.pulls.map((pull) => <div className={`saved-pull ${pull.included ? "" : "run-archived"}`} key={pull.id}><span className="pull-order">#{pull.pullNumber}</span><div><strong>{pull.bossName}</strong><small>{pull.difficulty} · {pull.duration}</small></div><span className={`pull-result ${pull.result === "Kill" ? "kill" : "wipe"}`}>{pull.result}</span><span className={`run-state ${pull.included ? "active" : "archived"}`}>{pull.included ? "Included" : "Excluded"}</span><button disabled={busy || !night.included || !report.included} onClick={() => onToggle("pull", pull.id, !pull.included)} type="button">{pull.included ? "Exclude pull" : "Restore pull"}</button></div>)}{report.pulls.length === 0 && <p className="detail-empty">No stored pulls were found in this report.</p>}</div></details>
      </section>)}</div>
    </section>)}{raidNights.length === 0 && <p className="detail-empty">No imported raid nights are available yet.</p>}</div>
  </article>;
}

function IdentityManager({ members, busy, status, onLink }: { members: RosterMember[]; busy: boolean; status: string; onLink: (playerId: string, identityId: string) => void }) {
  const activeMembers = members.filter((member) => member.included);
  return <article className="panel identity-manager"><div className="run-manager-heading"><div><p className="eyebrow muted"><span /> Raider identities</p><h2>Link mains and alternate characters</h2><p>Attendance follows the person. Choose another active character only when both names belong to the same raider.</p></div><div className="module-count"><strong>{new Set(activeMembers.map((member) => member.identityId ?? member.id)).size}</strong><small>Raiders</small></div></div>{status && <p className="roster-status" role="status">{status}</p>}<div className="identity-list">{activeMembers.map((member) => { const identity = members.find((candidate) => candidate.id === (member.identityId ?? member.id)); return <label key={member.id}><span className="roster-avatar">{member.name.slice(0, 2).toUpperCase()}</span><span><strong>{member.name}</strong><small>{member.spec} {member.className}{identity && identity.id !== member.id ? ` · linked with ${identity.name}` : " · own attendance"}</small></span><select disabled={busy} value={member.identityId ?? member.id} onChange={(event) => onLink(member.id, event.target.value)}><option value={member.id}>Keep separate</option>{activeMembers.filter((candidate) => candidate.id !== member.id).map((candidate) => <option value={candidate.identityId ?? candidate.id} key={candidate.id}>Same raider as {candidate.name}</option>)}</select></label>; })}</div></article>;
}

function AccessManager({ members }: { members: RosterMember[] }) {
  const [access, setAccess] = useState<AccessWorkspace | null>(null);
  const [tab, setTab] = useState<"players" | "officers">("players");
  const [status, setStatus] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const activeMembers = members.filter((member) => member.included);
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never opened";

  useEffect(() => {
    fetch("/api/access/manage")
      .then(async (response) => {
        const result = await response.json() as { access?: AccessWorkspace; error?: string };
        if (!response.ok || !result.access) throw new Error(result.error ?? "Access records could not be loaded.");
        return result.access;
      })
      .then(setAccess)
      .catch((error) => setStatus(error instanceof Error ? error.message : "Access records could not be loaded."));
  }, []);

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setStatus("Private link copied."); }
    catch { setCreatedUrl(url); setStatus("Copy this private link from the field below."); }
  }

  async function createPlayer(playerId: string) {
    setBusy(true); setStatus("Creating a living player link…"); setCreatedUrl("");
    try {
      const response = await fetch("/api/access/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "player", playerId }) });
      const result = await response.json() as { access?: AccessWorkspace; url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Player access could not be created.");
      if (result.access) setAccess(result.access); setCreatedUrl(result.url); await copy(result.url);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Player access could not be created."); }
    finally { setBusy(false); }
  }

  async function createOfficer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus("Creating a one-time officer link…"); setCreatedUrl("");
    const formElement = event.currentTarget;
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/access/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "officer", name: form.get("name"), deviceLabel: form.get("deviceLabel") }) });
      const result = await response.json() as { access?: AccessWorkspace; url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Officer access could not be created.");
      if (result.access) setAccess(result.access); setCreatedUrl(result.url); formElement.reset(); await copy(result.url);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Officer access could not be created."); }
    finally { setBusy(false); }
  }

  async function revoke(kind: "player" | "session" | "invite" | "officer" | "all_other_officers", id?: string, label?: string) {
    if (!window.confirm(kind === "all_other_officers" ? "Revoke every other officer device and every unused officer invite?" : `Revoke ${label ?? "this access"}?`)) return;
    setBusy(true); setStatus("Revoking access…"); setCreatedUrl("");
    try {
      const response = await fetch("/api/access/manage", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) });
      const result = await response.json() as { access?: AccessWorkspace; error?: string };
      if (!response.ok || !result.access) throw new Error(result.error ?? "Access could not be revoked.");
      setAccess(result.access); setStatus("Access revoked immediately.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Access could not be revoked."); }
    finally { setBusy(false); }
  }

  return <article className="panel access-manager">
    <div className="access-manager-heading"><div><p className="eyebrow muted"><span /> Link access</p><h2>Control every private link from one place</h2><p>Player links stay read-only and current. Officer links open a safe confirmation screen before activating a named device, then every session remains individually revocable.</p></div><div className="module-count"><strong>{(access?.players.length ?? 0) + (access?.officers.reduce((total, officer) => total + officer.sessions.length, 0) ?? 0)}</strong><small>Active access</small></div></div>
    <div className="access-tabs" role="tablist" aria-label="Access types"><button aria-selected={tab === "players"} className={tab === "players" ? "active" : ""} onClick={() => setTab("players")} role="tab" type="button">Players</button><button aria-selected={tab === "officers"} className={tab === "officers" ? "active" : ""} onClick={() => setTab("officers")} role="tab" type="button">Officers</button></div>
    {status && <p className="roster-status" role="status">{status}</p>}
    {createdUrl && <label className="created-access-link">New private link<input readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} /></label>}
    {!access && <p className="detail-empty">Loading active access…</p>}
    {access && tab === "players" && <div className="access-list">{activeMembers.map((member) => { const link = access.players.find((candidate) => candidate.playerId === member.id); return <div className="access-row" key={member.id}><span className="roster-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div className="access-player-detail"><strong>{member.name}</strong><small>{link ? `Created ${formatDate(link.createdAt)} · last opened ${formatDate(link.lastUsedAt)}` : "No active player link"}</small>{link && <label className="player-access-address"><span>Reusable player link</span><input aria-label={`${member.name}'s reusable player link`} readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} /></label>}</div><span className={`run-state ${link ? "active" : "archived"}`}>{link ? "Active" : "No link"}</span><div className="run-actions">{link ? <><button disabled={busy} onClick={() => copy(link.url)} type="button">Copy link</button><button className="danger-text" disabled={busy} onClick={() => revoke("player", link.token, `${member.name}'s player link`)} type="button">Revoke</button></> : <button disabled={busy} onClick={() => createPlayer(member.id)} type="button">Create link</button>}</div></div>; })}</div>}
    {access && tab === "officers" && <div className="officer-access-view"><form className="officer-invite-form" onSubmit={createOfficer}><label>Officer name<input name="name" placeholder="Officer A" required /></label><label>Device label<input name="deviceLabel" placeholder="Desktop or laptop" /></label><button className="primary-button" disabled={busy} type="submit">Create one-time link</button></form><div className="access-emergency"><div><strong>Emergency control</strong><small>Your current device stays active so you do not lock yourself out.</small></div><button className="danger-outline" disabled={busy} onClick={() => revoke("all_other_officers")} type="button">Revoke all other officer access</button></div><div className="officer-list">{access.officers.map((officer) => <section className="officer-card" key={officer.id}><div className="officer-card-heading"><div><strong>{officer.name}</strong><small>{officer.sessions.length} active device{officer.sessions.length === 1 ? "" : "s"} · {officer.invites.length} pending link{officer.invites.length === 1 ? "" : "s"}</small></div>{officer.name !== access.currentOfficerName && <button className="danger-text" disabled={busy} onClick={() => revoke("officer", officer.id, `all ${officer.name} access`)} type="button">Revoke officer</button>}</div>{officer.sessions.map((session) => <div className="officer-session" key={session.id}><div><strong>{session.deviceLabel}</strong><small>Last used {formatDate(session.lastUsedAt)} · activated {formatDate(session.createdAt)}</small></div><span className="run-state active">{session.current ? "This device" : "Active"}</span>{!session.current && <button disabled={busy} onClick={() => revoke("session", session.id, `${officer.name} · ${session.deviceLabel}`)} type="button">Revoke device</button>}</div>)}{officer.invites.map((invite) => <div className="officer-session pending" key={invite.id}><div className="officer-invite-detail"><strong>{invite.deviceLabel}</strong><small>Unused link · expires {formatDate(invite.expiresAt)}</small>{invite.url ? <label className="officer-invite-address"><span>Pending officer link</span><input aria-label={`${officer.name}'s pending officer link for ${invite.deviceLabel}`} readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} /></label> : <small>Create a replacement to display this older invitation&apos;s URL.</small>}</div><span className="run-state archived">Pending</span><div className="officer-invite-actions">{invite.url && <button disabled={busy} onClick={() => copy(invite.url!)} type="button">Copy link</button>}<button disabled={busy} onClick={() => revoke("invite", invite.id, `${officer.name}'s unused link`)} type="button">Cancel link</button></div></div>)}{!officer.sessions.length && !officer.invites.length && <p className="detail-empty">No active devices or pending links.</p>}</section>)}</div></div>}
  </article>;
}

function PlayerHistory({ history, linkedCharacters, activeKeys, loading, player }: { history: PlayerHistoryPoint[]; linkedCharacters: string[]; activeKeys: ScoreKey[]; loading: boolean; player: PlayerSnapshot }) {
  if (loading) return <section className="panel history-empty"><strong>Building {player.name}&apos;s season history…</strong></section>;
  if (!history.length) return <section className="panel history-empty"><strong>No raid-night history yet</strong><p>Import another night to start the week-over-week view.</p></section>;
  const latest = history.at(-1)!;
  const compact = (value: number | null) => value === null ? "—" : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value);
  return <section className="history-view"><article className="panel history-hero"><div><p className="eyebrow"><span /> Season history</p><h2>{history.length === 1 ? "Your first weekly baseline" : `${history.length} raid nights, one clear direction`}</h2><p>{linkedCharacters.length > 1 ? `Attendance combines ${linkedCharacters.join(" and ")}. ` : ""}Scores are rolled up by raid night; raw output stays visible without mixing it into Mechanics.</p></div><div className="history-latest"><small>Latest night</small><strong>{latest.present ? "Present" : "Absent"}</strong><span>{latest.pulls} pull{latest.pulls === 1 ? "" : "s"}</span></div></article><div className="history-score-grid">{activeKeys.map((key) => <article className="panel history-metric" key={key}><div><span>{scoreLabels[key]}</span><strong>{latest.scores[key] ?? "—"}</strong></div><div className="history-bars" aria-label={`${scoreLabels[key]} by raid night`}>{history.map((point) => <span key={point.raidNightId}><i style={{ height: `${point.scores[key] ?? 4}%` }} /><b>{point.scores[key] ?? "—"}</b><small>{new Date(point.happenedAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}</small></span>)}</div></article>)}</div><article className="panel history-table"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Night-by-night</p><h2>Progress without the guesswork</h2></div><span className="confidence">Identity-aware</span></div><div className="table-scroll"><table><thead><tr><th>Raid night</th><th>Present</th><th>Pulls</th><th>Mechanics</th><th>Performance</th><th>Attendance</th><th>{player.role === "Healer" ? "Avg HPS" : "Avg DPS"}</th></tr></thead><tbody>{[...history].reverse().map((point) => <tr key={point.raidNightId}><td><strong>{new Date(point.happenedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{point.label}</small></td><td><span className={`review-chip ${point.present ? "clear" : "attention"}`}>{point.present ? "Yes" : "No"}</span></td><td>{point.pulls}</td><td>{point.scores.mechanics ?? "—"}</td><td>{point.scores.performance ?? "—"}</td><td>{point.scores.attendance ?? "—"}</td><td>{compact(player.role === "Healer" ? point.hps : point.dps)}</td></tr>)}</tbody></table></div><p className="history-note">Compare DPS or HPS on the same boss and spec when judging output. Performance percentiles are the safer overall cross-boss trend.</p></article></section>;
}

function scoringMode(rule: MechanicRule) {
  return rule.condition.scoringMode ?? (["Interrupt", "Dispel", "Defensive", "Soak", "Utility"].includes(rule.category) ? "success" : "penalty");
}

function ruleEffect(rule: MechanicRule) {
  const mode = scoringMode(rule);
  if (mode === "success") return "Tracked success";
  if (mode === "context") return "Raid context";
  return `−${rule.weight}`;
}

function spellReferenceUrl(spellId: number) {
  return `https://www.wowhead.com/spell=${spellId}`;
}

function spellIconUrl(icon?: string) {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;
  const filename = icon.split("/").at(-1)?.replace(/\.(?:jpe?g|png|webp)$/i, "").toLowerCase();
  return filename ? `https://wow.zamimg.com/images/wow/icons/large/${encodeURIComponent(filename)}.jpg` : null;
}

function SpellIcon({ spellId, icon, name }: { spellId: number; icon?: string; name: string }) {
  const source = spellIconUrl(icon);
  return <a aria-label={`Look up ${name}, Spell ${spellId}`} className="spell-icon-link" href={spellReferenceUrl(spellId)} rel="noreferrer" target="_blank" title={`Look up ${name} · Spell ${spellId}`}><span className="spell-icon-fallback">?</span>{source && <img alt="" className="spell-icon" onError={(event) => { event.currentTarget.style.display = "none"; }} src={source} />}</a>;
}

function EventSpell({ event, fallbackIcon }: { event: RaidEvent; fallbackIcon?: string }) {
  return <span className="event-spell"><SpellIcon icon={event.icon ?? fallbackIcon} name={event.ability} spellId={event.spellId} /><span aria-hidden="true" className={`event-status ${event.kind}`}>{event.kind === "warning" || event.kind === "death" ? "!" : "✓"}</span></span>;
}

function OfficerAccessLanding({ checking }: { checking: boolean }) {
  return <main className="access-landing"><section><span className="brand-mark">SD</span><p className="eyebrow"><span /> Link access</p><h1>{checking ? "Checking this device…" : "This raid workspace is link-locked."}</h1><p>{checking ? "Your private officer session is being verified." : "Open a valid officer link to use the full workspace, or a player link to view one read-only player report."}</p>{!checking && <small>No raid data is available from the normal site address.</small>}</section></main>;
}

export function RaidApp({ initialData: fallbackData }: { initialData: DashboardData }) {
  const [initialData, setInitialData] = useState(fallbackData);
  const [view, setView] = useState<View>("home");
  const [configureSection, setConfigureSection] = useState<ConfigureSection>("people");
  const [playerTab, setPlayerTab] = useState<"review" | "history">("review");
  const [activeScore, setActiveScore] = useState<ScoreKey | null>(null);
  const [playerId, setPlayerId] = useState(initialData.players[0].id);
  const [bossId, setBossId] = useState(initialData.bosses[0].id);
  const [pullId, setPullId] = useState(initialData.pulls[0].id);
  const [rules, setRules] = useState(initialData.rules);
  const [editingRule, setEditingRule] = useState<MechanicRule | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reportUrls, setReportUrls] = useState("");
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([]);
  const [importSelections, setImportSelections] = useState<Record<string, number[]>>({});
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [importStatus, setImportStatus] = useState("");
  const [wclAllowance, setWclAllowance] = useState<WclAllowance>({ state: "checking" });
  const [importRaidNightId, setImportRaidNightId] = useState<string | null>(null);
  const [replaceReportCodes, setReplaceReportCodes] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  const [ruleStatus, setRuleStatus] = useState("");
  const [moduleStatus, setModuleStatus] = useState("");
  const [rosterStatus, setRosterStatus] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [identityStatus, setIdentityStatus] = useState("");
  const [runNights, setRunNights] = useState<RaidNightRecord[]>([]);
  const [history, setHistory] = useState<PlayerHistoryPoint[]>([]);
  const [linkedCharacters, setLinkedCharacters] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");
  const [officerName, setOfficerName] = useState("");
  const requestedIconSets = useRef(new Set<string>());

  function applyDashboard(nextData: DashboardData) {
    const nextBossId = nextData.bosses.some((candidate) => candidate.id === bossId) ? bossId : nextData.bosses[0].id;
    const nextPullId = nextData.pulls.some((candidate) => candidate.id === pullId) ? pullId : nextData.pulls.find((candidate) => candidate.bossId === nextBossId)?.id ?? nextData.pulls[0].id;
    const nextRoster = nextData.roster ?? [];
    setInitialData(nextData);
    setBossId(nextBossId);
    setPullId(nextPullId);
    setPlayerId(nextRoster.some((candidate) => candidate.id === playerId) ? playerId : nextRoster.find((candidate) => candidate.included)?.id ?? nextData.players[0].id);
    setRules(nextData.rules);
  }

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      try {
        const response = await fetch("/api/access/session", { cache: "no-store" });
        const result = await response.json() as { officer?: { name: string }; error?: string };
        if (!active) return;
        if (response.ok && result.officer) { setOfficerName(result.officer.name); setAccessState("granted"); }
        else { setOfficerName(""); setAccessState("denied"); }
      } catch { if (active) setAccessState("denied"); }
    }
    checkAccess();
    const timer = window.setInterval(checkAccess, 60_000);
    window.addEventListener("focus", checkAccess);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", checkAccess); };
  }, []);

  useEffect(() => {
    if (accessState !== "granted") return;
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
  }, [accessState]);

  useEffect(() => {
    if (accessState !== "granted") return;
    let active = true;
    fetch("/api/runs")
      .then(async (response) => response.ok ? response.json() as Promise<{ raidNights: RaidNightRecord[] }> : null)
      .then((result) => { if (active && result?.raidNights) setRunNights(result.raidNights); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [accessState]);

  useEffect(() => {
    if (accessState !== "granted") return;
    let active = true;
    fetch(`/api/history?playerId=${encodeURIComponent(playerId)}`)
      .then(async (response) => response.ok ? response.json() as Promise<{ history: PlayerHistoryPoint[]; linkedCharacters: string[] }> : null)
      .then((result) => {
        if (!active) return;
        setHistory(result?.history ?? []);
        setLinkedCharacters(result?.linkedCharacters ?? []);
      })
      .catch(() => { if (active) { setHistory([]); setLinkedCharacters([]); } })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [accessState, historyRevision, playerId]);

  useEffect(() => {
    if (accessState !== "granted" || view !== "configure" || configureSection !== "scoring") return;
    const allEvents = [...initialData.events, ...Object.values(initialData.pullEvents ?? {}).flat()];
    const missingSpellIds = [...new Set([
      ...rules.filter((rule) => !rule.icon).map((rule) => rule.spellId),
      ...allEvents.filter((event) => !event.icon).map((event) => event.spellId),
    ].filter((spellId) => Number.isInteger(spellId) && spellId > 0))].sort((a, b) => a - b);
    if (!initialData.reportCode || !missingSpellIds.length) return;
    const requestKey = `${initialData.reportCode}:${missingSpellIds.join(",")}`;
    if (requestedIconSets.current.has(requestKey)) return;
    requestedIconSets.current.add(requestKey);
    let active = true;
    fetch("/api/spell-icons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportCode: initialData.reportCode, spellIds: missingSpellIds }),
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ icons: Record<string, string> }> : null)
      .then((result) => {
        if (!active || !result?.icons) return;
        const withRuleIcons = (items: MechanicRule[]) => items.map((rule) => ({ ...rule, icon: rule.icon ?? result.icons[String(rule.spellId)] }));
        const withEventIcons = (items: RaidEvent[]) => items.map((event) => ({ ...event, icon: event.icon ?? result.icons[String(event.spellId)] }));
        setRules((current) => withRuleIcons(current));
        setInitialData((current) => ({
          ...current,
          rules: withRuleIcons(current.rules),
          events: withEventIcons(current.events),
          pullEvents: current.pullEvents ? Object.fromEntries(Object.entries(current.pullEvents).map(([id, events]) => [id, withEventIcons(events)])) : current.pullEvents,
        }));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [accessState, configureSection, initialData.events, initialData.pullEvents, initialData.reportCode, rules, view]);

  useEffect(() => {
    if (accessState !== "granted" || !importOpen) return;
    let active = true;
    fetch("/api/wcl-status", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as WclAllowance;
        if (!active) return;
        setWclAllowance(response.ok || response.status === 429 ? result : { state: "unavailable", error: result.error });
      })
      .catch(() => { if (active) setWclAllowance({ state: "unavailable" }); });
    return () => { active = false; };
  }, [accessState, importOpen]);

  useEffect(() => {
    if (accessState !== "granted" || !importOpen) return;
    let active = true;
    fetch("/api/import-jobs", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ jobs: ImportJob[] }> : null)
      .then((result) => {
        if (!active || !result) return;
        setImportJobs(result.jobs ?? []);
        if (result.jobs?.length) setImportStatus("An unfinished import was found. Continue from the saved checkpoint whenever Warcraft Logs is ready.");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [accessState, importOpen]);

  const boss = initialData.bosses.find((candidate) => candidate.id === bossId) ?? initialData.bosses[0];
  const pullOptions = initialData.pulls.filter((pull) => pull.bossId === bossId);
  const pull = pullOptions.find((candidate) => candidate.id === pullId) ?? pullOptions[0];
  const activePlayers = initialData.pullPlayers?.[pull?.id ?? pullId] ?? initialData.players;
  const moduleSettings = initialData.moduleSettings ?? defaultModuleSettings;
  const activeScoreKeys = scoreKeys.filter((key) => moduleSettings[key]);
  const activeRules = rules.filter((rule) => rule.enabled !== false);
  const rosterMembers = initialData.roster ?? initialData.players.map((candidate) => ({ id: candidate.id, name: candidate.name, realm: candidate.realm, className: candidate.className, spec: candidate.spec, role: candidate.role, pullsSeen: initialData.pulls.length, raidNights: 1, lastSeen: null, included: true }));
  const rosterPlayer = rosterMembers.find((candidate) => candidate.id === playerId) ?? rosterMembers.find((candidate) => candidate.included) ?? rosterMembers[0];
  const presentPlayer = activePlayers.find((candidate) => candidate.id === playerId);
  const playerPresent = Boolean(presentPlayer);
  const player: PlayerSnapshot = presentPlayer ?? {
    id: rosterPlayer.id, name: rosterPlayer.name, realm: rosterPlayer.realm, className: rosterPlayer.className, spec: rosterPlayer.spec, role: rosterPlayer.role,
    scores: { mechanics: null, performance: null, attendance: rosterPlayer.attendanceScore ?? 0, preparation: null }, parse: null, ilvlParse: null,
    attendanceLabel: `${rosterPlayer.attendanceScore ?? 0}% season attendance`, prepLabel: "Not evaluated", trend: [],
    summary: `No imported pull data for ${rosterPlayer.name} on this selected raid night and pull. Attendance still records the absence accurately.`,
    wins: ["Season history remains available across linked characters"], focus: ["Choose another raid night or pull to review combat details"],
    deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
  };
  const activeEvents = initialData.pullEvents?.[pull?.id ?? pullId] ?? initialData.events;
  const playerEvents = activeEvents.filter((event) => event.playerId === player.id);
  const findings = playerEvents.filter((event) => event.kind === "warning" || event.kind === "death").length;
  const mechanicsScore = moduleSettings.mechanics ? player.scores.mechanics : null;
  const matchedRules = activeRules.filter((rule) => playerEvents.some((event) => event.spellId === rule.spellId));
  const rulesBySpellId = new Map(activeRules.map((rule) => [rule.spellId, rule]));
  const heroSummary = !playerPresent ? player.summary : moduleSettings.mechanics
    ? player.summary
    : moduleSettings.performance
      ? `${player.parse === null ? "This pull has no ranked Warcraft Logs parse." : `Warcraft Logs shows a ${player.parse}th percentile ${player.role === "Healer" ? "healing" : "damage"} parse.`} Mechanics is currently paused.`
      : "The scoring modules for this view are currently paused. Your imported pull data is still safely stored.";
  const heroHeading = !playerPresent ? "No pull data" : moduleSettings.mechanics
    ? mechanicsScore === null ? "Ready for calibration" : mechanicsScore >= 90 ? "Good pull" : mechanicsScore >= 80 ? "Solid pull" : "Clear next step"
    : moduleSettings.performance ? "Performance checkpoint" : "Modules paused";
  const comparisonSortKey = moduleSettings.mechanics ? "mechanics" : activeScoreKeys[0];

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

  async function chooseRaidNight(nextRaidNightId: string) {
    setBusy(true); setActiveScore(null); setRunStatus("Loading that raid night…");
    try {
      const response = await fetch(`/api/dashboard?raidNightId=${encodeURIComponent(nextRaidNightId)}`);
      const result = await response.json() as { data?: DashboardData; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error ?? "That raid night could not be loaded.");
      applyDashboard(result.data);
      setRunStatus("");
    } catch (error) { setRunStatus(error instanceof Error ? error.message : "That raid night could not be loaded."); }
    finally { setBusy(false); }
  }

  function openNewImport() {
    setImportRaidNightId(null); setReplaceReportCodes([]); setReportUrls(""); setWclAllowance({ state: "checking" }); resetImportReview(); setImportOpen(true);
  }

  function addReportToNight(night: RaidNightRecord) {
    setImportRaidNightId(night.id); setReplaceReportCodes([]); setReportUrls(""); setWclAllowance({ state: "checking" }); resetImportReview(); setImportStatus(`The selected report will be added to ${night.name}.`); setImportOpen(true);
  }

  function replaceReport(report: RaidReportRecord) {
    const night = runNights.find((candidate) => candidate.reports.some((stored) => stored.id === report.id));
    setImportRaidNightId(night?.id ?? null); setReplaceReportCodes([report.code]); setReportUrls(report.url); setWclAllowance({ state: "checking" }); resetImportReview(); setImportStatus(`Review the pulls, then replace the saved copy of ${report.title}.`); setImportOpen(true);
  }

  async function updateRun(target: "raid_night" | "report" | "pull", id: string, included: boolean) {
    setBusy(true); setRunStatus(`${included ? "Restoring" : "Excluding"} ${target === "pull" ? "that pull" : "saved raid data"}…`);
    try {
      const response = await fetch("/api/runs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, id, included }) });
      const result = await response.json() as { error?: string; raidNights?: RaidNightRecord[] };
      if (!response.ok) throw new Error(result.error ?? "The saved run could not be updated.");
      setRunNights(result.raidNights ?? []);
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData; error?: string };
      if (dashboardResponse.ok && dashboardResult.data) applyDashboard(dashboardResult.data);
      setHistoryRevision((current) => current + 1);
      setRunStatus(included ? "The saved data is active again." : "The saved data is excluded from dashboards, history, averages, and attendance. Its original log data remains here so you can restore it.");
    } catch (error) { setRunStatus(error instanceof Error ? error.message : "The saved run could not be updated."); }
    finally { setBusy(false); }
  }

  async function deleteRun(target: "raid_night" | "report", id: string, label: string) {
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone. Exclude it instead if you may need it later.`)) return;
    setBusy(true); setRunStatus(`Permanently deleting ${label}…`);
    try {
      const response = await fetch("/api/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, id }) });
      const result = await response.json() as { error?: string; raidNights?: RaidNightRecord[] };
      if (!response.ok) throw new Error(result.error ?? "The saved run could not be deleted.");
      setRunNights(result.raidNights ?? []);
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData };
      if (dashboardResponse.ok && dashboardResult.data) applyDashboard(dashboardResult.data);
      setHistoryRevision((current) => current + 1);
      setRunStatus(`${label} was permanently deleted.`);
    } catch (error) { setRunStatus(error instanceof Error ? error.message : "The saved run could not be deleted."); }
    finally { setBusy(false); }
  }

  async function linkIdentity(characterId: string, identityId: string) {
    const character = rosterMembers.find((member) => member.id === characterId);
    setBusy(true); setIdentityStatus(`Updating ${character?.name ?? "character"}…`);
    try {
      const response = await fetch("/api/identities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: characterId, identityId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The character link could not be saved.");
      const dashboardResponse = await fetch(`/api/dashboard${initialData.raidNightId ? `?raidNightId=${encodeURIComponent(initialData.raidNightId)}` : ""}`);
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData; error?: string };
      if (!dashboardResponse.ok || !dashboardResult.data) throw new Error(dashboardResult.error ?? "The updated roster could not be loaded.");
      applyDashboard(dashboardResult.data); setHistoryRevision((current) => current + 1);
      setIdentityStatus("Character link saved. Attendance and History now treat those characters as one raider.");
    } catch (error) { setIdentityStatus(error instanceof Error ? error.message : "The character link could not be saved."); }
    finally { setBusy(false); }
  }

  async function previewReports(event: FormEvent) {
    event.preventDefault(); setBusy(true); setImportStatus("Reading every encounter in the report…"); setImportPreviews([]); setImportSelections({});
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", urls: reportUrls, season: initialData.season }) });
      const result = await response.json() as { error?: string; reports?: ImportPreview[]; needsConnection?: boolean; rateLimited?: boolean; retryAfterSeconds?: number };
      if (!response.ok) {
        if (result.rateLimited) setWclAllowance({ state: "full", percentRemaining: 0, pointsResetIn: result.retryAfterSeconds, error: result.error });
        throw new Error(result.needsConnection ? "The one-time Warcraft Logs connection still needs to be completed before the first import." : result.error ?? "Preview failed.");
      }
      const reports = result.reports ?? [];
      setImportPreviews(reports);
      setImportSelections(Object.fromEntries(reports.map((report) => [report.code, report.groups.filter((group) => group.defaultSelected).flatMap((group) => group.fights.map((fight) => fight.id))])));
      setImportStatus("Choose the content groups and individual pulls you want. Nothing has been saved yet.");
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The report could not be imported."); }
    finally { setBusy(false); }
  }

  async function runImportJobs(sourceJobs: ImportJob[]) {
    const queue = [...sourceJobs];
    for (let index = 0; index < queue.length; index += 1) {
      let current = queue[index];
      while (current.status !== "completed") {
        setImportStatus(current.completedPulls
          ? `Analyzing ${current.reportCode}: ${current.completedPulls} of ${current.totalPulls} pulls safely checkpointed…`
          : `Preparing ${current.reportCode} for a safe pull-by-pull import…`);
        const response = await fetch("/api/import-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process", jobId: current.id }),
        });
        const result = await response.json() as { error?: string; job?: ImportJob; rateLimited?: boolean; busy?: boolean };
        if (!response.ok || !result.job) throw new Error(result.error ?? "The next import checkpoint could not be completed.");
        current = result.job;
        queue[index] = current;
        setImportJobs((jobs) => jobs.map((job) => job.id === current.id ? current : job));
        if (result.rateLimited || current.status === "paused") {
          setWclAllowance({ state: "full", percentRemaining: 0, pointsResetIn: current.retryAfterSeconds, error: current.error ?? undefined });
          const resumes = current.resumeAfter ? new Date(current.resumeAfter).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
          setImportStatus(`${current.completedPulls} of ${current.totalPulls} pulls are safe. Warcraft Logs paused the import${resumes ? `; it can resume around ${resumes}` : ""}.`);
          return;
        }
        if (current.status === "failed") {
          setImportStatus(current.error ?? "The import stopped at a safe checkpoint. Retry when ready.");
          return;
        }
        if (result.busy) {
          setImportStatus("An import step is still finishing. Wait a moment, then continue from the same checkpoint.");
          return;
        }
      }
    }
    setImportStatus("Every selected pull is complete. Opening the refreshed raid dashboard…");
    window.setTimeout(() => window.location.reload(), 700);
  }

  async function confirmImport() {
    const selections = importPreviews.map((preview) => ({ code: preview.code, fightIds: importSelections[preview.code] ?? [], startedAt: preview.startedAt }));
    if (!selections.some((selection) => selection.fightIds.length)) { setImportStatus("Select at least one pull to import."); return; }
    setBusy(true); setImportStatus("Creating a safe, resumable import…");
    try {
      const response = await fetch("/api/import-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", urls: reportUrls, season: initialData.season, selections, raidNightId: importRaidNightId, replaceReportCodes }) });
      const result = await response.json() as { error?: string; jobs?: ImportJob[]; skipped?: { code: string; reason: string }[] };
      if (!response.ok) throw new Error(result.error ?? "The resumable import could not be created.");
      const jobs = result.jobs ?? [];
      setImportJobs(jobs);
      setImportPreviews([]);
      if (!jobs.length) {
        setImportStatus(result.skipped?.some((item) => item.reason === "already_imported") ? "This report is already imported. Use Replace / reimport from Raid Data if you want to rebuild it." : "No new pulls were queued.");
        return;
      }
      await runImportJobs(jobs);
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The report could not be imported."); }
    finally { setBusy(false); }
  }

  async function resumeImport() {
    const unfinished = importJobs.filter((job) => job.status !== "completed");
    if (!unfinished.length) return;
    setBusy(true);
    try { await runImportJobs(unfinished); }
    catch (error) { setImportStatus(error instanceof Error ? error.message : "The import could not resume."); }
    finally { setBusy(false); }
  }

  async function cancelImport(job: ImportJob) {
    if (!window.confirm(`Remove the unfinished import for ${job.reportCode}? Completed raid data is not affected.`)) return;
    setBusy(true); setImportStatus(`Removing the unfinished ${job.reportCode} import…`);
    try {
      const response = await fetch("/api/import-jobs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The unfinished import could not be removed.");
      setImportJobs((jobs) => jobs.filter((candidate) => candidate.id !== job.id));
      setImportStatus("The unfinished import and its invisible staging data were removed.");
    } catch (error) { setImportStatus(error instanceof Error ? error.message : "The unfinished import could not be removed."); }
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const nextRule: MechanicRule = {
      id: editingRule?.id ?? `rule-${crypto.randomUUID()}`, bossId, spellId: Number(form.get("spellId")), name: String(form.get("name") ?? ""),
      category: String(form.get("category")) as MechanicRule["category"], severity: String(form.get("severity")) as MechanicRule["severity"],
      weight: Number(form.get("weight")), eventType: String(form.get("eventType")) as MechanicRule["eventType"],
      difficulties: form.getAll("difficulty").map(String), roles: form.getAll("role").map(String),
      condition: { minAmount: Number(form.get("minAmount")) || undefined, countOncePerCast: form.get("countOnce") === "on", ignoreTanks: form.get("ignoreTanks") === "on", scoringMode: String(form.get("scoringMode") ?? "penalty") as NonNullable<MechanicRule["condition"]["scoringMode"]>, maxOccurrencesPerPull: Number(form.get("maxOccurrencesPerPull")) || undefined, note: String(form.get("note") ?? "") || undefined },
      icon: editingRule?.icon,
      enabled: editingRule?.enabled ?? true,
    };
    try {
      const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextRule) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Rule could not be saved.");
      setRules((current) => [nextRule, ...current.filter((rule) => rule.id !== nextRule.id)]); setRuleStatus(nextRule.enabled === false ? `${nextRule.name} is saved and remains paused.` : `${nextRule.name} is saved and active. Recalculate saved pulls when the rule set is ready.`); setEditingRule(null); formElement.reset();
    } catch (error) { setRuleStatus(error instanceof Error ? error.message : "Rule could not be saved."); }
    finally { setBusy(false); }
  }

  function editRule(rule: MechanicRule) {
    setEditingRule(rule);
    setRuleStatus(`Editing ${rule.name}. Saving will keep the same rule and history.`);
  }

  function duplicateRule(rule: MechanicRule) {
    setEditingRule({ ...rule, id: `rule-${crypto.randomUUID()}`, name: `${rule.name} copy`, enabled: true });
    setRuleStatus(`Duplicating ${rule.name}. Adjust the copy, then save it as a new rule.`);
  }

  async function toggleRule(rule: MechanicRule) {
    const enabled = rule.enabled === false;
    setBusy(true); setRuleStatus(`${enabled ? "Restoring" : "Pausing"} ${rule.name}…`);
    try {
      const response = await fetch("/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rule.id, enabled }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The rule state could not be changed.");
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData; error?: string };
      if (!dashboardResponse.ok || !dashboardResult.data) throw new Error(dashboardResult.error ?? "The refreshed rule library could not be loaded.");
      applyDashboard(dashboardResult.data);
      if (editingRule?.id === rule.id) setEditingRule(null);
      setRuleStatus(enabled ? `${rule.name} is active again. Recalculate saved pulls to apply it.` : `${rule.name} is paused and remains here for recovery. Recalculate saved pulls to refresh stored scores.`);
    } catch (error) { setRuleStatus(error instanceof Error ? error.message : "The rule state could not be changed."); }
    finally { setBusy(false); }
  }

  async function toggleModule(key: ScoreKey) {
    const enabled = !moduleSettings[key];
    setBusy(true); setModuleStatus(`${enabled ? "Turning on" : "Pausing"} ${scoreLabels[key]}…`);
    try {
      const response = await fetch("/api/modules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The score module could not be updated.");
      setInitialData((current) => ({ ...current, moduleSettings: { ...(current.moduleSettings ?? defaultModuleSettings), [key]: enabled } }));
      if (!enabled && activeScore === key) setActiveScore(null);
      setModuleStatus(enabled ? `${scoreLabels[key]} is active across dashboards, comparisons, and private reports.` : `${scoreLabels[key]} is paused everywhere. Its stored data was not deleted.`);
    } catch (error) { setModuleStatus(error instanceof Error ? error.message : "The score module could not be updated."); }
    finally { setBusy(false); }
  }

  async function reanalyzeBoss() {
    setBusy(true); setRuleStatus(`Recalculating every saved ${boss.name} pull…`);
    try {
      const response = await fetch("/api/reanalyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bossId }) });
      const result = await response.json() as { error?: string; pulls?: number; events?: number; rules?: number };
      if (!response.ok) throw new Error(result.error ?? "The saved pulls could not be recalculated.");
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboardResult = await dashboardResponse.json() as { data?: DashboardData; error?: string };
      if (!dashboardResponse.ok || !dashboardResult.data) throw new Error(dashboardResult.error ?? "The refreshed dashboard could not be loaded.");
      applyDashboard(dashboardResult.data);
      setRuleStatus(`${result.pulls ?? 0} saved pull${result.pulls === 1 ? "" : "s"} recalculated with ${result.rules ?? 0} rules and ${result.events ?? 0} relevant events.`);
    } catch (error) { setRuleStatus(error instanceof Error ? error.message : "The saved pulls could not be recalculated."); }
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

  async function signOutOfficerDevice() {
    if (!window.confirm("Sign out and revoke officer access on this device?")) return;
    await fetch("/api/access/session", { method: "DELETE" }).catch(() => undefined);
    setOfficerName(""); setAccessState("denied");
  }

  if (accessState !== "granted") return <OfficerAccessLanding checking={accessState === "checking"} />;

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => setView("home")} aria-label="Return to Scurvy Dogs home"><span className="brand-mark">SD</span><span><strong>Scurvy Dogs</strong><small>Raid Intelligence</small></span></button>
        <nav aria-label="Primary navigation">
          <button className={view === "home" ? "active" : ""} type="button" onClick={() => setView("home")}>Home</button>
          <button className={view === "player" ? "active" : ""} type="button" onClick={() => setView("player")}>Player view</button>
          <button className={view === "officer" ? "active" : ""} type="button" onClick={() => setView("officer")}>Officer view</button>
          <button className={view === "configure" ? "active" : ""} type="button" onClick={() => setView("configure")}>Configure</button>
        </nav>
        <div className="header-actions"><span className="demo-pill real-data">{initialData.dataSource?.label ?? "Raid dataset"}</span><button className="import-button" type="button" onClick={openNewImport}>Import logs</button><button className="avatar" type="button" aria-label={`Sign out ${officerName} on this device`} onClick={signOutOfficerDevice} title={`${officerName} · sign out this device`}>{officerName.slice(0, 2).toUpperCase() || "OF"}</button></div>
      </header>

      {view === "home" && <section className="dashboard home-menu" id="home">
        <div className="home-intro"><p className="eyebrow"><span /> Officer workspace</p><h1>Where do you want to start?</h1><p>Choose a workspace first. No player is selected until you decide to open the player dashboard.</p></div>
        <div className="home-pillars" aria-label="Scurvy Dogs workspaces">
          <button className="home-pillar home-pillar-player" onClick={() => setView("player")} type="button"><span className="home-pillar-number">01</span><span className="home-pillar-icon">P</span><span className="home-pillar-copy"><small>Individual coaching</small><strong>Player View</strong><p>Choose a raider once, then review their raid night, boss, pull, mechanics, performance, and history.</p></span><span className="home-pillar-footer"><b>{rosterMembers.filter((member) => member.included).length} active raiders</b><i>Open player dashboard →</i></span></button>
          <button className="home-pillar home-pillar-officer" onClick={() => setView("officer")} type="button"><span className="home-pillar-number">02</span><span className="home-pillar-icon">O</span><span className="home-pillar-copy"><small>Raid-wide context</small><strong>Officer View</strong><p>Compare the active roster, spot team-wide patterns, and identify who needs attention on the selected pull.</p></span><span className="home-pillar-footer"><b>{initialData.pulls.length} pulls available</b><i>Open officer view →</i></span></button>
          <button className="home-pillar home-pillar-configure" onClick={() => setView("configure")} type="button"><span className="home-pillar-number">03</span><span className="home-pillar-icon">C</span><span className="home-pillar-copy"><small>Control center</small><strong>Configure</strong><p>Manage raid data, roster and alts, scoring rules, modules, and every player or officer access link.</p></span><span className="home-pillar-footer"><b>{activeRules.length} active rules</b><i>Open configuration →</i></span></button>
        </div>
        <div className="home-quickbar"><div><small>Current raid night</small><strong>{initialData.raidNight}</strong><span>{initialData.raid} · {initialData.bosses.length} bosses · {initialData.pulls.length} pulls</span></div><button className="import-button" onClick={openNewImport} type="button">Import a new raid log</button></div>
      </section>}

      {view === "player" && <section className="dashboard" id="dashboard">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Player dashboard · {initialData.raidNight}</p><button className="share-button" disabled={busy || !playerPresent} onClick={createShare} type="button">Share private view</button></div>
        <div className="hero-row"><div><h1>{heroHeading}, {player.name}.</h1><p>{heroSummary}</p></div><div className="context-chip"><span>{pull?.difficulty}</span><strong>{pull?.duration}</strong><small>{pull?.killed ? "Kill" : "Wipe"}</small></div></div>
        {initialData.dataSource && <div className="status-line data-source-line"><span /><a href={initialData.dataSource.reportUrl} target="_blank" rel="noreferrer">{initialData.dataSource.detail}</a>{initialData.dataSource.wipefestUrl && <a href={initialData.dataSource.wipefestUrl} target="_blank" rel="noreferrer">Open Wipefest</a>}</div>}
        {shareStatus && <div className="status-line" role="status"><span />{shareStatus}</div>}
        {runStatus && <div className="status-line" role="status"><span />{runStatus}</div>}
        <div className="filters" aria-label="Dashboard filters">
          <label>Player<select value={player.id} onChange={(event) => { setHistoryLoading(true); setPlayerId(event.target.value); }}>{rosterMembers.filter((candidate) => candidate.included).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.spec} {candidate.className}</option>)}</select></label>
          <label>Raid night<select disabled={busy} value={initialData.raidNightId ?? ""} onChange={(event) => chooseRaidNight(event.target.value)}>{(initialData.raidNights ?? [{ id: initialData.raidNightId ?? "", name: initialData.raidNight, happenedAt: "" }]).map((night) => <option value={night.id} key={night.id}>{night.name}</option>)}</select></label>
          <label>Boss<select value={bossId} onChange={(event) => chooseBoss(event.target.value)}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
          <label>Pull<select value={pull?.id} onChange={(event) => setPullId(event.target.value)}>{pullOptions.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label>
          <p><span className="live-dot" /> {boss.name} · {activeRules.filter((rule) => rule.bossId === boss.id).length} active rules · {pullOptions.length} pulls</p>
        </div>
        <div className="player-tabs" role="tablist" aria-label="Player dashboard sections"><button aria-selected={playerTab === "review"} className={playerTab === "review" ? "active" : ""} onClick={() => setPlayerTab("review")} role="tab" type="button">Raid review</button><button aria-selected={playerTab === "history"} className={playerTab === "history" ? "active" : ""} onClick={() => { setPlayerTab("history"); setActiveScore(null); }} role="tab" type="button">History</button></div>
        {playerTab === "review" && <>
        <section className={`score-grid score-grid-${activeScoreKeys.length}`} aria-label="Player scores">
          {activeScoreKeys.map((key) => {
            const index = scoreKeys.indexOf(key);
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
          {activeScoreKeys.length === 0 && <article className="module-empty"><strong>All score modules are paused</strong><p>Imported pull data is still stored. Turn on a module from Configure whenever you are ready to use it.</p></article>}
        </section>
        {activeScore && <section aria-live="polite" className={`panel score-detail-panel detail-${activeScore}`} id="score-detail-panel">
          <div className="score-detail-heading"><div><p className="eyebrow"><span /> {scoreLabels[activeScore]} detail</p><h2>{activeScore === "mechanics" ? "What changed the mechanic score" : activeScore === "performance" ? "How the performance score was built" : activeScore === "attendance" ? "What attendance currently covers" : "What preparation data is available"}</h2><p>{activeScore === "mechanics" ? "Actual Wipefest scoring, timeline events, and the matching encounter rules for this player." : activeScore === "performance" ? `Warcraft Logs ${player.role === "Healer" ? "healing" : "damage"} parses from this exact pull, shown with item-level context.` : activeScore === "attendance" ? "Attendance counts included raid nights once and combines any alternate characters linked to this raider." : "Wipefest exposed raid-level preparation, but not a trustworthy individual breakdown on the public report."}</p></div><button aria-label="Close score details" onClick={() => setActiveScore(null)} type="button">×</button></div>
          {activeScore === "mechanics" && <>
            <div className="score-detail-stats"><span><small>Player score</small><strong>{player.scores.mechanics ?? "N/A"}</strong><em>{initialData.dataSource?.label === "Live Warcraft Logs import" ? "Configured rules" : "Wipefest"}</em></span><span><small>Raid average</small><strong>{officerSummary.mechanics ?? "N/A"}</strong><em>{activePlayers.length} players</em></span><span><small>Timeline findings</small><strong>{playerEvents.length}</strong><em>{findings} need review</em></span><span><small>Matched rules</small><strong>{matchedRules.length}</strong><em>Spell-ID based</em></span></div>
            <div className="score-detail-columns"><div><h3>Events from this pull</h3><ul className="events detail-event-list">{playerEvents.map((event) => <li key={`detail-${event.id}`}><EventSpell event={event} fallbackIcon={rulesBySpellId.get(event.spellId)?.icon} /><div><a className="event-ability-link" href={spellReferenceUrl(event.spellId)} rel="noreferrer" target="_blank">{event.ability}</a><small>{event.detail}</small></div><time>{event.timestamp}</time></li>)}</ul></div><div><h3>Rules that matched</h3><div className="detail-rule-list">{matchedRules.map((rule) => <div key={`detail-${rule.id}`}><SpellIcon icon={rule.icon} name={rule.name} spellId={rule.spellId} /><p><strong>{rule.name}</strong><small><a href={spellReferenceUrl(rule.spellId)} rel="noreferrer" target="_blank">Spell {rule.spellId}</a> · weight {rule.weight}</small></p><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span></div>)}{matchedRules.length === 0 && <p className="detail-empty">No configured rule matched this player&apos;s displayed timeline events.</p>}</div></div></div>
          </>}
          {activeScore === "performance" && <><div className="score-detail-stats"><span><small>WCL parse</small><strong>{player.parse ?? "N/A"}</strong><em>{player.role === "Healer" ? "Healing" : "Damage"}</em></span><span><small>Item-level parse</small><strong>{player.ilvlParse ?? "N/A"}</strong><em>Item level {player.itemLevel ?? "—"}</em></span><span><small>Performance</small><strong>{player.scores.performance ?? "N/A"}</strong><em>Transparent blend</em></span><span><small>Active pull</small><strong>{pull?.duration}</strong><em>{pull?.label}</em></span></div><div className="detail-explanation"><strong>The current formula</strong><p>Performance = 65% Warcraft Logs parse + 35% item-level parse. It keeps raw output visible while adding context for the gear available to the player. This score does not affect Mechanics, Attendance, or Preparation.</p></div></>}
          {activeScore === "attendance" && <><div className="score-detail-stats"><span><small>Tracked nights</small><strong>{history.filter((point) => point.present).length}/{history.length || 1}</strong><em>Included raid nights</em></span><span><small>Selected night</small><strong>{playerPresent ? "Present" : "Absent"}</strong><em>{initialData.raidNight}</em></span><span><small>Attendance</small><strong>{player.scores.attendance ?? "N/A"}</strong><em>Identity-aware</em></span><span><small>Linked characters</small><strong>{Math.max(1, linkedCharacters.length)}</strong><em>{linkedCharacters.join(", ") || player.name}</em></span></div><div className="detail-explanation"><strong>How it is counted</strong><p>Each included raid night counts once, even when it contains multiple Warcraft Logs reports. Any linked main or alternate character marks the same raider present.</p></div></>}
          {activeScore === "preparation" && <><div className="score-detail-stats"><span><small>Individual score</small><strong>{player.scores.preparation ?? "N/A"}</strong><em>Not assumed</em></span><span><small>Raid flasks</small><strong>{initialData.preparationRaid?.flasks ?? "N/A"}{initialData.preparationRaid?.flasks !== null && initialData.preparationRaid?.flasks !== undefined && initialData.preparationRaid.total ? `/${initialData.preparationRaid.total}` : ""}</strong><em>Available source</em></span><span><small>Raid food</small><strong>{initialData.preparationRaid?.food ?? "N/A"}{initialData.preparationRaid?.food !== null && initialData.preparationRaid?.food !== undefined && initialData.preparationRaid.total ? `/${initialData.preparationRaid.total}` : ""}</strong><em>Available source</em></span><span><small>Player penalty</small><strong>None</strong><em>No guessing</em></span></div><div className="detail-explanation"><strong>What we know</strong><p>{initialData.preparationSummary} The app intentionally leaves this player score blank rather than assigning incomplete raid data to an individual.</p></div></>}
        </section>}
        {moduleSettings.mechanics && <><section className="insight-grid">
          <article className="panel takeaways"><div className="panel-heading"><div><p className="eyebrow"><span /> 10-second review</p><h2>Your pull, distilled</h2></div><span className="confidence">High confidence</span></div><div className="takeaway good"><span className="takeaway-icon">✓</span><div><strong>What went well</strong><p>{player.wins.slice(0, 2).join(" · ")}</p></div></div><div className="takeaway watch"><span className="takeaway-icon">!</span><div><strong>One thing to fix</strong><p>{player.focus[0]}</p></div></div></article>
          <article className="panel event-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Key events</p><h2>What shaped the score</h2></div><span className="event-count">{playerEvents.length} relevant</span></div><ul className="events">{playerEvents.slice(0, 4).map((event) => <li key={event.id}><EventSpell event={event} fallbackIcon={rulesBySpellId.get(event.spellId)?.icon} /><div><a className="event-ability-link" href={spellReferenceUrl(event.spellId)} rel="noreferrer" target="_blank">{event.ability}</a><small>{event.detail}</small></div><time>{event.timestamp}</time></li>)}</ul></article>
        </section>
        <section className="lower-grid">
          <article className="panel trend-panel"><div><p className="eyebrow muted"><span /> Trend</p><h2>{player.trend.length > 1 ? `Mechanics are moving ${player.trend.at(-1)! >= player.trend[0] ? "up" : "down"}` : "First mechanics baseline"}</h2><p>{player.trend.length > 1 ? "Last six evaluated pulls" : "One calibrated pull · future raids will build the trend"}</p></div><div className="trend-bars" aria-label={`Mechanics trend: ${player.trend.join(", ")}`}>{player.trend.map((value, index) => <i key={`${value}-${index}`} style={{ height: `${value}%` }}><span>{value}</span></i>)}</div></article>
          <article className="panel stat-panel"><p className="eyebrow muted"><span /> Pull facts</p><h2>Evidence, not mystery</h2><div className="fact-grid"><span><strong>{player.deaths}</strong><small>Timeline deaths</small></span><span><strong>{player.avoidableDamage >= 1000000 ? `${(player.avoidableDamage / 1000000).toFixed(1)}m` : `${Math.round(player.avoidableDamage / 1000)}k`}</strong><small>Tracked avoidable</small></span><span><strong>{player.interrupts + player.dispels}</strong><small>Dispels / utility</small></span><span><strong>{player.itemLevel ?? "—"}</strong><small>Item level</small></span></div></article>
        </section></>}
        </>}
        {playerTab === "history" && <PlayerHistory activeKeys={activeScoreKeys} history={history} linkedCharacters={linkedCharacters} loading={historyLoading} player={player} />}
      </section>}

      {view === "officer" && <section className="dashboard officer-view" id="officer">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Officer workspace · full roster</p><button className="share-button" type="button" onClick={openNewImport}>Add raid reports</button></div>
        <div className="section-hero"><div><h1>See the whole roster, clearly.</h1><p>{activeScoreKeys.length} active independent signal{activeScoreKeys.length === 1 ? "" : "s"}. Paused modules stay out of comparisons until you turn them back on.</p></div><div className="hierarchy-note"><small>Current scope</small><strong>{initialData.season}</strong><span>Season → Night → Report → Boss → Pull → Player</span></div></div>
        <section className={`officer-summary officer-summary-${activeScoreKeys.length}`}>{activeScoreKeys.map((key) => {
          const value = officerSummary[key];
          return <article key={key}><span>{scoreLabels[key]} average</span><strong>{value ?? "N/A"}</strong><small>{value === null ? "Not public" : key === "attendance" ? "First tracked night" : "Real snapshot"}</small></article>;
        })}{activeScoreKeys.length === 0 && <article className="module-empty"><span>All score modules are paused</span><small>Roster data remains available.</small></article>}</section>
        <article className="panel roster-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Roster comparison</p><h2>{boss.name} · {pull?.label}</h2></div><div className="legend"><span><i className="good-dot" /> 90+</span><span><i className="watch-dot" /> Below 80</span></div></div><div className="table-scroll"><table><thead><tr><th>Player</th><th>Role</th>{activeScoreKeys.map((key) => <th key={key}>{scoreLabels[key]}</th>)}<th>Review</th></tr></thead><tbody>{[...activePlayers].sort((a, b) => comparisonSortKey ? (b.scores[comparisonSortKey] ?? -1) - (a.scores[comparisonSortKey] ?? -1) : a.name.localeCompare(b.name)).map((candidate) => { const needsReview = activeScoreKeys.some((key) => candidate.scores[key] !== null && candidate.scores[key] < 80); return <tr key={candidate.id}><td><button className="player-cell" type="button" onClick={() => { setPlayerId(candidate.id); setView("player"); }}><span>{candidate.name.slice(0, 2).toUpperCase()}</span><strong>{candidate.name}<small>{candidate.spec} {candidate.className}</small></strong></button></td><td>{candidate.role}</td>{activeScoreKeys.map((key) => { const value = candidate.scores[key]; return <td key={key}><span className={`table-score ${value !== null && value >= 90 ? "high" : value !== null && value < 80 ? "low" : ""}`}>{value ?? "—"}</span></td>; })}<td><span className={`review-chip ${needsReview ? "attention" : "clear"}`}>{needsReview ? "Needs context" : "Clear"}</span></td></tr>; })}</tbody></table></div></article>
        <div className="officer-footnote"><strong>Privacy by workflow</strong><span>Officers compare the full roster here. Player links are generated separately and include only one player plus anonymous averages.</span></div>
      </section>}

      {view === "configure" && <section className="dashboard config-view" id="configure">
        <div className="eyebrow-row"><p className="eyebrow"><span /> Encounter configuration</p><button className="share-button" type="button" onClick={openNewImport}>Import reports</button></div>
        <div className="section-hero"><div><h1>Set up the raid in a sensible order.</h1><p>Clean the roster, link alternate characters, maintain mechanics, and control every player or officer link without mixing the workflows together.</p></div><div className="engine-note"><span>Configuration</span><b>→</b><span>Analysis engine</span><b>→</b><span>Four scores</span></div></div>
        <div className="configure-tabs" role="tablist" aria-label="Configure sections">
          <button aria-controls="configure-raid-data" aria-selected={configureSection === "raid-data"} className={configureSection === "raid-data" ? "active" : ""} id="configure-raid-data-tab" onClick={() => setConfigureSection("raid-data")} role="tab" type="button"><span>Raid data</span><small>Nights & reports</small></button>
          <button aria-controls="configure-people" aria-selected={configureSection === "people"} className={configureSection === "people" ? "active" : ""} id="configure-people-tab" onClick={() => setConfigureSection("people")} role="tab" type="button"><span>Roster & alts</span><small>Clean roster, then link</small></button>
          <button aria-controls="configure-scoring" aria-selected={configureSection === "scoring"} className={configureSection === "scoring" ? "active" : ""} id="configure-scoring-tab" onClick={() => setConfigureSection("scoring")} role="tab" type="button"><span>Scoring & rules</span><small>Modules & mechanics</small></button>
          <button aria-controls="configure-access" aria-selected={configureSection === "access"} className={configureSection === "access" ? "active" : ""} id="configure-access-tab" onClick={() => setConfigureSection("access")} role="tab" type="button"><span>Access</span><small>Players & officers</small></button>
        </div>
        {configureSection === "raid-data" && <div aria-labelledby="configure-raid-data-tab" className="configure-section" id="configure-raid-data" role="tabpanel"><RaidNightManager raidNights={runNights} busy={busy} status={runStatus} onToggle={updateRun} onDelete={deleteRun} onReplace={replaceReport} onAdd={addReportToNight} /></div>}
        {configureSection === "people" && <div aria-labelledby="configure-people-tab" className="configure-section" id="configure-people" role="tabpanel">
          <RosterManager members={rosterMembers} busy={busy} status={rosterStatus} onToggle={updateRoster} />
          <IdentityManager members={rosterMembers} busy={busy} status={identityStatus} onLink={linkIdentity} />
        </div>}
        {configureSection === "scoring" && <div aria-labelledby="configure-scoring-tab" className="configure-section" id="configure-scoring" role="tabpanel">
          <ModuleManager settings={moduleSettings} busy={busy} status={moduleStatus} onToggle={toggleModule} />
          <div className="config-filters"><label>Raid<select defaultValue={initialData.raid}><option>{initialData.raid}</option></select></label><label>Boss<select value={bossId} onChange={(event) => { chooseBoss(event.target.value); setEditingRule(null); }}>{initialData.bosses.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label><div><span>Active rules</span><strong>{activeRules.filter((rule) => rule.bossId === bossId).length}</strong></div><button className="share-button" disabled={busy || !activeRules.some((rule) => rule.bossId === bossId)} onClick={reanalyzeBoss} type="button">Recalculate saved pulls</button></div>
          {ruleStatus && <p className="config-status" role="status">{ruleStatus}</p>}
          <section className="config-grid">
          <article className="panel rules-panel"><div className="panel-heading"><div><p className="eyebrow muted"><span /> Rule library</p><h2>{boss.name}</h2></div><span className="confidence">Config-driven</span></div><div className="rule-list">{rules.filter((rule) => rule.bossId === bossId).sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false)).map((rule) => <div className={`rule-row ${rule.enabled === false ? "rule-row-paused" : ""}`} key={rule.id}><span className={`severity severity-${rule.severity.toLowerCase()}`}>{rule.severity}</span><div className="rule-identity"><SpellIcon icon={rule.icon} name={rule.name} spellId={rule.spellId} /><div className="rule-copy"><strong>{rule.name}</strong><small><a href={spellReferenceUrl(rule.spellId)} rel="noreferrer" target="_blank">Spell {rule.spellId}</a> · {rule.category}</small><p>{rule.roles.join(", ")} · {rule.difficulties.join(", ")}{rule.condition.note ? ` · ${rule.condition.note}` : ""}</p></div></div><div className="rule-controls"><b>{rule.enabled === false ? "Paused" : ruleEffect(rule)}</b><div><button disabled={busy} onClick={() => editRule(rule)} type="button">Edit</button><button disabled={busy} onClick={() => duplicateRule(rule)} type="button">Duplicate</button><button disabled={busy} onClick={() => toggleRule(rule)} type="button">{rule.enabled === false ? "Restore" : "Pause"}</button></div></div></div>)}{!rules.some((rule) => rule.bossId === bossId) && <div className="empty-rules">No rules for this boss yet. Add the first one beside this list.</div>}</div></article>
          <form className="panel rule-form" key={editingRule?.id ?? "new-rule"} onSubmit={addRule}><p className="eyebrow"><span /> {editingRule ? editingRule.name.endsWith(" copy") ? "Duplicate mechanic rule" : "Edit mechanic rule" : "New mechanic rule"}</p><div className="rule-form-heading"><h2>{editingRule ? editingRule.name.endsWith(" copy") ? "Create a safe copy" : "Adjust this rule" : "Teach the analyzer"}</h2>{editingRule && <button onClick={() => { setEditingRule(null); setRuleStatus(""); }} type="button">Cancel</button>}</div><div className="form-pair"><label>Mechanic name<input defaultValue={editingRule?.name} name="name" placeholder="e.g. Gilded Wave" required /></label><label>Spell ID<input defaultValue={editingRule?.spellId} name="spellId" inputMode="numeric" placeholder="451117" required /></label></div><div className="form-pair"><label>Category<select name="category" defaultValue={editingRule?.category ?? "Avoidable damage"}><option>Avoidable damage</option><option>Mechanic failure</option><option>Interrupt</option><option>Dispel</option><option>Defensive</option><option>Soak</option><option>Utility</option></select></label><label>Event type<select name="eventType" defaultValue={editingRule?.eventType ?? "damage"}><option>damage</option><option>debuff</option><option>cast</option><option>interrupt</option><option>dispel</option><option>death</option></select></label></div><div className="form-pair"><label>Score effect<select name="scoringMode" defaultValue={editingRule ? scoringMode(editingRule) : "penalty"}><option value="penalty">Penalty · lowers Mechanics</option><option value="success">Success · evidence only</option><option value="context">Raid context · no player score</option></select></label><label>Penalty weight<input defaultValue={editingRule?.weight ?? 4} name="weight" inputMode="decimal" required /></label></div><div className="form-pair"><label>Severity<select name="severity" defaultValue={editingRule?.severity ?? "Medium"}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label><label>Maximum matches per pull<input defaultValue={editingRule?.condition.maxOccurrencesPerPull} name="maxOccurrencesPerPull" inputMode="numeric" placeholder="No limit" /></label></div><fieldset><legend>Applies on</legend>{["Normal", "Heroic", "Mythic"].map((difficulty) => <label key={difficulty}><input defaultChecked={editingRule ? editingRule.difficulties.includes(difficulty) : difficulty !== "Normal"} name="difficulty" type="checkbox" value={difficulty} /> {difficulty}</label>)}</fieldset><fieldset><legend>Roles</legend>{["Tank", "Healer", "DPS"].map((role) => <label key={role}><input defaultChecked={editingRule ? editingRule.roles.includes(role) : true} name="role" type="checkbox" value={role} /> {role === "Tank" ? "Tanks" : role === "Healer" ? "Healers" : "DPS"}</label>)}</fieldset><details><summary>Optional conditions</summary><label>Minimum amount<input defaultValue={editingRule?.condition.minAmount} name="minAmount" inputMode="numeric" placeholder="50000" /></label><label className="checkline"><input defaultChecked={editingRule?.condition.countOncePerCast} name="countOnce" type="checkbox" /> Count once per cast</label><label className="checkline"><input defaultChecked={editingRule?.condition.ignoreTanks} name="ignoreTanks" type="checkbox" /> Ignore tanks</label><label>Rule note<textarea defaultValue={editingRule?.condition.note} name="note" placeholder="Ignore the first unavoidable tick…" /></label></details><button className="primary-button" disabled={busy} type="submit">{editingRule ? editingRule.name.endsWith(" copy") ? "Save duplicate rule" : "Save rule changes" : "Save mechanic rule"}</button></form>
          </section>
        </div>}
        {configureSection === "access" && <div aria-labelledby="configure-access-tab" className="configure-section" id="configure-access" role="tabpanel"><AccessManager members={rosterMembers} /></div>}
      </section>}

      {importOpen && <ImportModal
        reportUrls={reportUrls}
        previews={importPreviews}
        selections={importSelections}
        jobs={importJobs}
        allowance={wclAllowance}
        busy={busy}
        status={importStatus}
        onClose={() => setImportOpen(false)}
        onUrlsChange={(value) => { setReportUrls(value); resetImportReview(); }}
        onReview={previewReports}
        onConfirm={confirmImport}
        onResume={resumeImport}
        onCancel={cancelImport}
        onToggleGroup={toggleImportGroup}
        onToggleFight={toggleImportFight}
        onReset={resetImportReview}
      />}
    </main>
  );
}
