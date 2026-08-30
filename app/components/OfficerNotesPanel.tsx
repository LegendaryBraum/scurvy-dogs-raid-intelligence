"use client";

import { useState, type FormEvent } from "react";
import type { OfficerNote, RosterMember } from "../../lib/types";

export type NoteEditorPayload = {
  id?: string;
  body: string;
  visibility: "player" | "officer";
  scope: OfficerNote["scope"];
  raidNightId?: string;
  bossId?: string;
  pullId?: string;
};

export function OfficerNotesPanel({ players, playerId, playerName, notes, raidNightId, raidNightName, bossId, bossName, pullId, pullLabel, busy, status, onPlayerChange, onSave, onDelete }: {
  players: RosterMember[];
  playerId: string;
  playerName: string;
  notes: OfficerNote[];
  raidNightId?: string;
  raidNightName: string;
  bossId: string;
  bossName: string;
  pullId?: string;
  pullLabel?: string;
  busy: boolean;
  status: string;
  onPlayerChange: (playerId: string) => void;
  onSave: (payload: NoteEditorPayload) => Promise<boolean>;
  onDelete: (note: OfficerNote) => void;
}) {
  const [editing, setEditing] = useState<OfficerNote | null>(null);
  const defaultScope: OfficerNote["scope"] = pullId ? "pull" : raidNightId ? "raid_night" : "player";
  const [scope, setScope] = useState<OfficerNote["scope"]>(defaultScope);
  const [visibility, setVisibility] = useState<OfficerNote["visibility"]>("player");
  const [body, setBody] = useState("");

  function reset() { setEditing(null); setScope(defaultScope); setVisibility("player"); setBody(""); }
  function edit(note: OfficerNote) {
    setEditing(note);
    setScope(note.scope);
    setVisibility(note.visibility);
    setBody(note.body);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const keepExistingScope = editing?.scope === scope;
    const saved = await onSave({
      id: editing?.id,
      body,
      visibility,
      scope,
      raidNightId: scope === "player" ? undefined : keepExistingScope ? editing?.raidNightId ?? undefined : raidNightId,
      bossId: scope === "boss" || scope === "pull" ? keepExistingScope ? editing?.bossId ?? undefined : bossId : undefined,
      pullId: scope === "pull" ? keepExistingScope ? editing?.pullId ?? undefined : pullId : undefined,
    });
    if (saved) reset();
  }

  const scopePreview = scope === "player" ? `${playerName} · all raid nights` : scope === "raid_night" ? raidNightName : scope === "boss" ? `${raidNightName} · ${bossName}` : `${raidNightName} · ${bossName} · ${pullLabel ?? "Current pull"}`;
  return <section className="officer-notes-workspace">
    <form className="panel officer-note-editor" onSubmit={submit}>
      <div className="panel-heading"><div><p className="eyebrow"><span /> Officer coaching</p><h2>{editing ? "Edit coaching context" : "Add the context numbers cannot"}</h2></div><span className="confidence">{notes.length} saved</span></div>
      <div className="note-editor-grid">
        <label>Player<select disabled={busy || Boolean(editing)} value={playerId} onChange={(event) => onPlayerChange(event.target.value)}>{players.filter((player) => player.included).map((player) => <option value={player.id} key={player.id}>{player.name} · {player.spec} {player.className}</option>)}</select></label>
        <label>Applies to<select disabled={busy} value={scope} onChange={(event) => setScope(event.target.value as OfficerNote["scope"])}><option value="pull">This pull</option><option value="boss">This boss tonight</option><option value="raid_night">This raid night</option><option value="player">Player overall</option></select></label>
      </div>
      <small className="note-scope-preview">{scopePreview}</small>
      <label>Coaching note<textarea maxLength={1500} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add assignment context, explain an unusual death, or call out improvement…" required /></label>
      <div className="note-visibility-choice" role="radiogroup" aria-label="Who can read this note">
        <label aria-label="Player-visible note" className={visibility === "player" ? "selected" : ""} htmlFor="note-visibility-player"><input checked={visibility === "player"} id="note-visibility-player" name="visibility" onChange={() => setVisibility("player")} type="radio" /> <span><strong>Player-visible</strong><small>Appears live on this player&apos;s private link</small></span></label>
        <label aria-label="Officers-only note" className={visibility === "officer" ? "selected" : ""} htmlFor="note-visibility-officer"><input checked={visibility === "officer"} id="note-visibility-officer" name="visibility" onChange={() => setVisibility("officer")} type="radio" /> <span><strong>Officers only</strong><small>Never included in a player response</small></span></label>
      </div>
      {status && <p className="roster-status" role="status">{status}</p>}
      <div className="note-editor-actions"><button className="primary-button" disabled={busy || !body.trim()} type="submit">{busy ? "Saving…" : editing ? "Save note changes" : "Add coaching note"}</button>{editing && <button disabled={busy} onClick={reset} type="button">Cancel edit</button>}</div>
    </form>
    <article className="panel officer-note-library">
      <div className="panel-heading"><div><p className="eyebrow muted"><span /> {playerName}</p><h2>Saved coaching history</h2></div><span className="event-count">{notes.length} note{notes.length === 1 ? "" : "s"}</span></div>
      <div className="officer-note-list">{notes.map((note) => <article className={`saved-officer-note saved-note-${note.visibility}`} key={note.id}><div><span>{note.scopeLabel}</span><b>{note.visibility === "player" ? "Player can see" : "Officers only"}</b></div><p>{note.body}</p><footer><small>{note.authorName} · updated {new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small><span><button disabled={busy} onClick={() => edit(note)} type="button">Edit</button><button className="danger-text" disabled={busy} onClick={() => onDelete(note)} type="button">Remove</button></span></footer></article>)}{!notes.length && <p className="detail-empty">No coaching notes have been saved for this raider identity yet.</p>}</div>
    </article>
  </section>;
}
