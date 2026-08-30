"use client";

import { Fragment, useState, type FormEvent } from "react";
import type { OfficerHistoryKill, OfficerNote, OfficerPlayerHistory, ScoreKey } from "../../lib/types";
import type { NoteEditorPayload } from "./OfficerNotesPanel";

const scoreLabels: Record<ScoreKey, string> = { mechanics: "Mechanics", performance: "Performance", attendance: "Attendance", preparation: "Preparation" };

function compact(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function date(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function InlineKillNoteEditor({ playerId, kill, editing, busy, onSave, onCancel }: {
  playerId: string;
  kill: OfficerHistoryKill;
  editing: OfficerNote | null;
  busy: boolean;
  onSave: (playerId: string, payload: NoteEditorPayload) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(editing?.body ?? "");
  const [visibility, setVisibility] = useState<OfficerNote["visibility"]>(editing?.visibility ?? "player");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave(playerId, {
      id: editing?.id,
      body,
      visibility,
      scope: "pull",
      raidNightId: kill.raidNightId,
      pullId: kill.pullId,
    });
    if (saved) onCancel();
  }

  return <form className="kill-note-editor" onSubmit={submit}>
    <label>Note for this kill<textarea maxLength={1500} onChange={(event) => setBody(event.target.value)} placeholder="Add assignment context, call out improvement, or explain what happened…" required value={body} /></label>
    <div className="kill-note-options" role="radiogroup" aria-label="Who can read this note">
      <label><input checked={visibility === "player"} name={`visibility-${kill.pullId}`} onChange={() => setVisibility("player")} type="radio" /> Player can see</label>
      <label><input checked={visibility === "officer"} name={`visibility-${kill.pullId}`} onChange={() => setVisibility("officer")} type="radio" /> Officers only</label>
    </div>
    <div className="kill-note-actions"><button className="primary-button" disabled={busy || !body.trim()} type="submit">{editing ? "Save changes" : "Add note"}</button><button disabled={busy} onClick={onCancel} type="button">Cancel</button></div>
  </form>;
}

export function OfficerHistoryRoster({ players, activeKeys, expandedPlayerId, notes, busy, loading, status, onTogglePlayer, onSaveNote, onDeleteNote }: {
  players: OfficerPlayerHistory[];
  activeKeys: ScoreKey[];
  expandedPlayerId: string | null;
  notes: OfficerNote[];
  busy: boolean;
  loading: boolean;
  status: string;
  onTogglePlayer: (playerId: string) => void;
  onSaveNote: (playerId: string, payload: NoteEditorPayload) => Promise<boolean>;
  onDeleteNote: (playerId: string, note: OfficerNote) => void;
}) {
  const [editingPullId, setEditingPullId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<OfficerNote | null>(null);
  const bossScoreKeys = activeKeys.filter((key) => key !== "attendance");
  const sorted = [...players].sort((a, b) => (b.scores.mechanics ?? b.scores.performance ?? -1) - (a.scores.mechanics ?? a.scores.performance ?? -1) || a.name.localeCompare(b.name));

  function openEditor(pullId: string, note: OfficerNote | null = null) {
    setEditingPullId(pullId);
    setEditingNote(note);
  }

  return <article className="panel officer-history-roster">
    <div className="panel-heading"><div><p className="eyebrow muted"><span /> Season roster history</p><h2>One row per raider, every included night</h2><p>These are identity-aware season averages—not a single selected pull. Select a raider to open their boss history and individual kills.</p></div><span className="confidence">{players.length} raiders</span></div>
    {status && <p className="roster-status" role="status">{status}</p>}
    {loading ? <p className="detail-empty">Building the roster&apos;s season history…</p> : !players.length ? <p className="detail-empty">No active raider history is available yet.</p> : <div className="table-scroll"><table className="officer-history-table"><thead><tr><th>Raider</th><th>Role</th><th>History</th>{activeKeys.map((key) => <th key={key}>{scoreLabels[key]} avg</th>)}<th>Review</th></tr></thead><tbody>{sorted.map((player) => {
      const expanded = player.playerId === expandedPlayerId;
      const needsReview = activeKeys.some((key) => player.scores[key] !== null && player.scores[key]! < 80);
      return <Fragment key={player.playerId}>
        <tr className={expanded ? "officer-history-row expanded" : "officer-history-row"}><td><button aria-controls={`officer-history-${player.playerId}`} aria-expanded={expanded} className="player-cell officer-history-toggle" onClick={() => onTogglePlayer(player.playerId)} type="button"><span>{player.name.slice(0, 2).toUpperCase()}</span><strong>{player.name}<small>{player.spec} {player.className}</small></strong><i aria-hidden="true">{expanded ? "−" : "+"}</i></button></td><td>{player.role}</td><td><strong>{player.pulls} pulls</strong><small>{player.nightsAttended}/{player.totalRaidNights} nights</small></td>{activeKeys.map((key) => <td key={key}><span className={`table-score ${player.scores[key] !== null && player.scores[key]! >= 90 ? "high" : player.scores[key] !== null && player.scores[key]! < 80 ? "low" : ""}`}>{player.scores[key] ?? "—"}</span></td>)}<td><span className={`review-chip ${needsReview ? "attention" : "clear"}`}>{needsReview ? "Review" : "Steady"}</span></td></tr>
        {expanded && <tr className="officer-history-expansion"><td colSpan={activeKeys.length + 4}><section id={`officer-history-${player.playerId}`}><div className="history-expansion-heading"><div><p className="eyebrow"><span /> {player.name}&apos;s boss history</p><h3>Season averages with every saved kill underneath</h3></div><small>Last seen {date(player.lastSeenAt)}</small></div><div className="officer-boss-history">{player.bosses.map((boss) => <article className="officer-boss-card" key={boss.bossId}><header><div><h4>{boss.bossName}</h4><span>{boss.pulls} pull{boss.pulls === 1 ? "" : "s"} · {boss.kills} kill{boss.kills === 1 ? "" : "s"}</span></div><small>Last seen {date(boss.lastSeenAt)}</small></header><div className="boss-average-grid">{bossScoreKeys.map((key) => <span key={key}><small>{scoreLabels[key]} avg</small><strong>{boss.scores[key] ?? "—"}</strong></span>)}<span><small>Average {player.role === "Healer" ? "HPS" : "DPS"}</small><strong>{compact(player.role === "Healer" ? boss.averageHps : boss.averageDps)}</strong></span></div><div className="boss-kill-history"><div className="boss-kill-heading"><strong>Individual kills</strong><small>Notes here stay attached to this exact kill.</small></div>{boss.killHistory.map((kill) => {
          const killNotes = notes.filter((note) => note.pullId === kill.pullId);
          const editorOpen = editingPullId === kill.pullId;
          return <section className="boss-kill-row" key={kill.pullId}><div className="boss-kill-summary"><div><strong>{date(kill.happenedAt)}</strong><small>{kill.raidNightName} · {kill.difficulty} · {kill.characterName} ({kill.spec})</small></div><span><small>Mechanics</small><b>{kill.scores.mechanics ?? "—"}</b></span><span><small>Performance</small><b>{kill.scores.performance ?? "—"}</b></span><span><small>WCL parse</small><b>{kill.parse ?? "—"}</b></span><span><small>{player.role === "Healer" ? "HPS" : "DPS"}</small><b>{compact(player.role === "Healer" ? kill.hps : kill.dps)}</b></span><button disabled={busy} onClick={() => editorOpen ? openEditor("", null) : openEditor(kill.pullId)} type="button">{editorOpen ? "Close note" : "Add note"}</button></div>{killNotes.length > 0 && <div className="kill-saved-notes">{killNotes.map((note) => <article key={note.id}><p>{note.body}</p><footer><span>{note.visibility === "player" ? "Player can see" : "Officers only"}</span><small>{note.authorName} · {date(note.updatedAt)}</small><button disabled={busy} onClick={() => openEditor(kill.pullId, note)} type="button">Edit</button><button className="danger-text" disabled={busy} onClick={() => onDeleteNote(player.playerId, note)} type="button">Remove</button></footer></article>)}</div>}{editorOpen && <InlineKillNoteEditor key={`${kill.pullId}:${editingNote?.id ?? "new"}`} playerId={player.playerId} kill={kill} editing={editingNote} busy={busy} onSave={onSaveNote} onCancel={() => openEditor("", null)} />}</section>;
        })}{!boss.killHistory.length && <p className="detail-empty">No included kill yet. The averages above still include progression pulls.</p>}</div></article>)}{!player.bosses.length && <p className="detail-empty">No boss history is available for this raider.</p>}</div></section></td></tr>}
      </Fragment>;
    })}</tbody></table></div>}
  </article>;
}
