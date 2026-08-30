import type { OfficerNote } from "./types";

type NoteRow = {
  id: string;
  player_id: string;
  author_name: string;
  visibility: string;
  body: string;
  raid_night_id: string | null;
  boss_id: string | null;
  pull_id: string | null;
  raid_night_name: string | null;
  boss_name: string | null;
  pull_number: number | null;
  created_at: string;
  updated_at: string;
};

export async function resolveRaiderIdentity(db: D1Database, playerId: string) {
  const row = await db.prepare(`
    SELECT p.id, COALESCE(pi.identity_id, p.id) AS identity_id
    FROM players p
    LEFT JOIN player_identities pi ON pi.player_id = p.id
    WHERE p.id = ?
  `).bind(playerId).first<{ id: string; identity_id: string }>();
  return row?.identity_id ?? null;
}

function mapNote(row: NoteRow): OfficerNote {
  const scope: OfficerNote["scope"] = row.pull_id ? "pull" : row.boss_id ? "boss" : row.raid_night_id ? "raid_night" : "player";
  const parts = [
    row.raid_night_name,
    row.boss_name,
    row.pull_id && row.pull_number ? `Pull ${row.pull_number}` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    id: row.id,
    playerId: row.player_id,
    authorName: row.author_name,
    visibility: row.visibility === "officer" ? "officer" : "player",
    scope,
    scopeLabel: parts.join(" · ") || "All raid nights",
    body: row.body,
    raidNightId: row.raid_night_id,
    bossId: row.boss_id,
    pullId: row.pull_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readNotes(db: D1Database, identityId: string, playerVisibleOnly: boolean) {
  const result = await db.prepare(`
    SELECT n.id, n.player_id, o.name AS author_name, n.visibility, n.body,
           n.raid_night_id, n.boss_id, n.pull_id, n.created_at, n.updated_at,
           rn.name AS raid_night_name, b.name AS boss_name, pu.pull_number
    FROM officer_notes n
    JOIN officers o ON o.id = n.author_officer_id
    LEFT JOIN raid_nights rn ON rn.id = n.raid_night_id
    LEFT JOIN bosses b ON b.id = n.boss_id
    LEFT JOIN pulls pu ON pu.id = n.pull_id
    WHERE n.player_id = ? AND (? = 0 OR n.visibility = 'player')
    ORDER BY n.updated_at DESC, n.created_at DESC
  `).bind(identityId, playerVisibleOnly ? 1 : 0).all<NoteRow>();
  return result.results.map(mapNote);
}

export async function loadOfficerNotes(db: D1Database, playerId: string) {
  const identityId = await resolveRaiderIdentity(db, playerId);
  return identityId ? readNotes(db, identityId, false) : [];
}

export async function loadPlayerVisibleNotes(db: D1Database, identityId: string) {
  return readNotes(db, identityId, true);
}
