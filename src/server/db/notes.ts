import { type Db, nowIso } from "./db.ts";

export function releaseNote(db: Db, releaseId: number): string | null | undefined {
  const row = db.prepare("SELECT notes FROM release_notes WHERE release_id = ?").get(releaseId) as
    | { notes: string | null }
    | undefined;
  return row?.notes;
}

export function saveReleaseNote(db: Db, releaseId: number, notes: string | null): void {
  db.transaction(() => {
    db.prepare(`INSERT INTO release_notes (release_id, notes, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
      WHERE release_notes.notes IS NOT excluded.notes`).run(releaseId, notes, nowIso());
    db.prepare(`UPDATE verdicts SET notes = ? WHERE key =
      (SELECT triage_key FROM releases WHERE id = ?) AND notes IS NOT ?`).run(
      notes,
      releaseId,
      notes,
    );
  })();
}
