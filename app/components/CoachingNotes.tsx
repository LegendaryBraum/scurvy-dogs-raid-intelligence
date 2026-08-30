"use client";

import type { OfficerNote } from "../../lib/types";

function isRelevant(note: OfficerNote, raidNightId?: string, bossId?: string, pullId?: string) {
  if (note.scope === "player") return true;
  if (note.scope === "raid_night") return note.raidNightId === raidNightId;
  if (note.scope === "boss") return note.raidNightId === raidNightId && note.bossId === bossId;
  return note.pullId === pullId;
}

export function CoachingNotes({ notes, raidNightId, bossId, pullId, audience }: { notes: OfficerNote[]; raidNightId?: string; bossId?: string; pullId?: string; audience: "officer" | "player" }) {
  const relevant = notes.filter((note) => isRelevant(note, raidNightId, bossId, pullId));
  if (!relevant.length && audience === "player") return null;
  return <section className="panel coaching-notes">
    <div className="panel-heading"><div><p className="eyebrow"><span /> Raid team context</p><h2>{audience === "player" ? "A note from your officers" : "Coaching notes for this view"}</h2></div><span className="event-count">{relevant.length} relevant</span></div>
    <div className="coaching-note-list">{relevant.map((note) => <article className={`coaching-note coaching-note-${note.visibility}`} key={note.id}>
      <p>{note.body}</p>
      <footer><span>{note.scopeLabel}</span><small>{note.authorName} · {new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small>{audience === "officer" && <b>{note.visibility === "player" ? "Player can see" : "Officers only"}</b>}</footer>
    </article>)}{!relevant.length && <p className="detail-empty">No coaching note applies to this player and selected scope yet. Add one from Officer View.</p>}</div>
  </section>;
}
