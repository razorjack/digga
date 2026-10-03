import type { Db } from "./db.ts";

/**
 * Runs a write the verdict and track mark logs must not record: a restore, whose history has its
 * own events, or a rekey. The log triggers skip changes while `restoring_decisions` is set. Call
 * it inside a transaction, so a failed write also rolls back the flag; a nested call leaves the
 * flag to the outer one.
 */
export function withoutChangeLogs<T>(db: Db, write: () => T): T {
  const flagged = db
    .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('restoring_decisions', '1')")
    .run().changes;
  const result = write();
  if (flagged > 0) db.prepare("DELETE FROM meta WHERE key = 'restoring_decisions'").run();
  return result;
}
