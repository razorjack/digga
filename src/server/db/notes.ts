import type { PressingNote } from "../../shared/api.ts";
import { type Db, nowIso } from "./db.ts";

/** The release's note: undefined when none was ever saved, null when it was cleared. */
export function releaseNote(db: Db, releaseId: number): string | null | undefined {
  const row = db.prepare("SELECT notes FROM release_notes WHERE release_id = ?").get(releaseId) as
    | { notes: string | null }
    | undefined;
  return row?.notes;
}

/** Saves the release's note; a cleared note keeps its row, so an older backup cannot revive it. */
export function saveReleaseNote(db: Db, releaseId: number, notes: string | null): void {
  db.prepare(
    `INSERT INTO release_notes (release_id, notes, updated_at)
     VALUES (@release_id, @notes, @updated_at)
     ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
     WHERE release_notes.notes IS NOT excluded.notes`,
  ).run({ release_id: releaseId, notes, updated_at: nowIso() });
}

/** Notes written on the other pressings of the release's master, newest first. */
export function pressingNotes(
  db: Db,
  release: { id: number; masterId: number | null },
): PressingNote[] {
  if (release.masterId === null) return [];
  return db
    .prepare(
      `SELECT n.release_id AS releaseId, r.catno, n.notes FROM release_notes n
       JOIN releases r ON r.id = n.release_id
       WHERE r.master_id = ? AND r.id <> ? AND n.notes IS NOT NULL
       ORDER BY n.updated_at DESC`,
    )
    .all(release.masterId, release.id) as PressingNote[];
}

/** Shelf notes, including other pressings, read together instead of once per record. */
export function notesForReleases(
  db: Db,
  releases: { id: number; masterId: number | null }[],
): Map<number, { note: string | null; pressingNotes: PressingNote[] }> {
  if (releases.length === 0) return new Map();
  const ids = releases.map((release) => release.id);
  const masters = [...new Set(releases.map((release) => release.masterId))];
  const rows = db
    .prepare(`SELECT n.release_id AS releaseId, r.master_id AS masterId,
      r.catno, n.notes FROM release_notes n JOIN releases r ON r.id = n.release_id
    WHERE n.notes IS NOT NULL AND (r.id IN (SELECT value FROM json_each(@ids))
      OR r.master_id IN (SELECT value FROM json_each(@masters)))
    ORDER BY n.updated_at DESC`)
    .all({ ids: JSON.stringify(ids), masters: JSON.stringify(masters) }) as (PressingNote & {
    masterId: number | null;
  })[];
  const ownNotes = new Map(rows.map((row) => [row.releaseId, row.notes]));
  const byMaster = Map.groupBy(rows, (row) => row.masterId);
  const notes = new Map<number, { note: string | null; pressingNotes: PressingNote[] }>();
  for (const release of releases) {
    const siblings = release.masterId === null ? [] : (byMaster.get(release.masterId) ?? []);
    notes.set(release.id, {
      note: ownNotes.get(release.id) ?? null,
      pressingNotes: siblings
        .filter((row) => row.releaseId !== release.id)
        .map(({ releaseId, catno, notes }) => ({ releaseId, catno, notes })),
    });
  }
  return notes;
}
