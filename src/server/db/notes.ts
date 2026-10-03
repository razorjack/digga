import { type Db, nowIso } from "./db.ts";

/** The release's note: undefined when none was ever saved, null when it was cleared. */
export function releaseNote(db: Db, releaseId: number): string | null | undefined {
  const row = db.prepare("SELECT notes FROM release_notes WHERE release_id = ?").get(releaseId) as
    | { notes: string | null }
    | undefined;
  return row?.notes;
}

/** The release's note when it was saved after `time`, an ISO timestamp. */
export function releaseNoteSavedAfter(
  db: Db,
  releaseId: number,
  time: string,
): { notes: string | null } | undefined {
  return db
    .prepare("SELECT notes FROM release_notes WHERE release_id = ? AND updated_at > ?")
    .get(releaseId, time) as { notes: string | null } | undefined;
}

/** Saves the release's note and copies it to the verdict of its record, if there is one. */
export function saveReleaseNote(db: Db, releaseId: number, notes: string | null): void {
  const params = { release_id: releaseId, notes, updated_at: nowIso() };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO release_notes (release_id, notes, updated_at)
       VALUES (@release_id, @notes, @updated_at)
       ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
       WHERE release_notes.notes IS NOT excluded.notes`,
    ).run(params);
    db.prepare(
      `UPDATE verdicts SET notes = @notes
       WHERE key = (SELECT triage_key FROM releases WHERE id = @release_id) AND notes IS NOT @notes`,
    ).run({ release_id: releaseId, notes });
  })();
}
