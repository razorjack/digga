import type { DumpLoadSummary } from "../../shared/api.ts";
import { type Db, getMeta } from "./db.ts";

interface DumpLoadRow {
  id: number;
  file: string;
  dump_date: string | null;
  started_at: string;
  finished_at: string | null;
  added: number | null;
  coverage: number | null;
  missing: number | null;
}

/** Records a load as it starts; its id marks the releases it adds. */
export function startDumpLoadRecord(
  db: Db,
  load: { file: string; dumpDate: string | null; startedAt: string },
): number {
  const info = db
    .prepare("INSERT INTO dump_loads (file, dump_date, started_at) VALUES (?, ?, ?)")
    .run(load.file, load.dumpDate, load.startedAt);
  return Number(info.lastInsertRowid);
}

/**
 * Records what the load changed. `complete` is false for a load stopped by a limit, which cannot
 * tell which releases are gone.
 */
export function finishDumpLoadRecord(
  db: Db,
  id: number,
  outcome: { coverage: number; complete: boolean; finishedAt: string },
): DumpLoadSummary {
  db.transaction(() => {
    adoptUnfinishedLoads(db, id);
    const added = db
      .prepare("SELECT COUNT(*) FROM releases WHERE added_by_load = ?")
      .pluck()
      .get(id) as number;
    const missing = outcome.complete ? countMissing(db, id) : null;
    db.prepare(
      "UPDATE dump_loads SET finished_at = ?, added = ?, coverage = ?, missing = ? WHERE id = ?",
    ).run(outcome.finishedAt, added, outcome.coverage, missing, id);
  })();
  return getDumpLoad(db, id)!;
}

/**
 * Releases added by earlier loads that did not finish count as this load's, since no finished
 * load has reported them. Their rows go; what only they wrote counts as not found.
 */
function adoptUnfinishedLoads(db: Db, id: number): void {
  const unfinished = "SELECT id FROM dump_loads WHERE finished_at IS NULL AND id < ?";
  db.prepare(`UPDATE releases SET added_by_load = ? WHERE added_by_load IN (${unfinished})`).run(
    id,
    id,
  );
  db.prepare(
    `UPDATE releases SET written_by_load = NULL WHERE written_by_load IN (${unfinished})`,
  ).run(id);
  db.prepare("DELETE FROM dump_loads WHERE finished_at IS NULL AND id < ?").run(id);
}

/** Universe releases the load did not write: a dump load rewrites every release it keeps. */
function countMissing(db: Db, id: number): number {
  return db
    .prepare("SELECT COUNT(*) FROM releases WHERE in_universe = 1 AND written_by_load IS NOT ?")
    .pluck()
    .get(id) as number;
}

export function getDumpLoad(db: Db, id: number): DumpLoadSummary | null {
  const row = db.prepare("SELECT * FROM dump_loads WHERE id = ?").get(id) as
    | DumpLoadRow
    | undefined;
  return row ? rowToSummary(row) : null;
}

/** The newest load that finished. */
export function latestDumpLoad(db: Db): DumpLoadSummary | null {
  const row = db
    .prepare("SELECT * FROM dump_loads WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get() as DumpLoadRow | undefined;
  return row ? rowToSummary(row) : null;
}

function rowToSummary(row: DumpLoadRow): DumpLoadSummary {
  return {
    id: row.id,
    file: row.file,
    dumpDate: row.dump_date,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    added: row.added ?? 0,
    coverage: row.coverage ?? 0,
    missing: row.missing,
  };
}

const ADDED_BY_UNFINISHED_LOAD =
  "added_by_load IN (SELECT id FROM dump_loads WHERE finished_at IS NULL)";

/** Anything the user made or imported that names the release or its record. */
const HAS_PERSONAL_DATA = `(
  EXISTS (SELECT 1 FROM verdicts v WHERE v.key = releases.triage_key OR v.release_id = releases.id)
  OR EXISTS (SELECT 1 FROM track_verdicts t WHERE t.release_id = releases.id)
  OR EXISTS (SELECT 1 FROM release_notes n WHERE n.release_id = releases.id)
  OR EXISTS (SELECT 1 FROM user_videos u WHERE u.release_id = releases.id)
  OR EXISTS (SELECT 1 FROM listen_log l WHERE l.release_id = releases.id)
  OR EXISTS (SELECT 1 FROM memberships s WHERE s.release_id = releases.id))`;

/**
 * Undoes loads that did not finish, for the setup's "Change your picks": the releases they
 * brought into the universe leave it. Those the user has data on stay as stubs, outside the
 * universe like a seed's release, so a later load that finds them takes them back; the others
 * are deleted. Returns how many it deleted.
 */
export function forgetUnfinishedLoads(db: Db): number {
  return db.transaction(() => {
    db.prepare(
      `UPDATE releases SET in_universe = 0, added_by_load = NULL, written_by_load = NULL
       WHERE ${ADDED_BY_UNFINISHED_LOAD} AND ${HAS_PERSONAL_DATA}`,
    ).run();
    return db.prepare(`DELETE FROM releases WHERE ${ADDED_BY_UNFINISHED_LOAD}`).run().changes;
  })();
}

/**
 * Some load has finished. Loads from before `dump_loads` existed left no row, only the time in
 * meta, which every finished load still writes.
 */
export function hasLoadedCatalogue(db: Db): boolean {
  return latestDumpLoad(db) !== null || getMeta(db, "dump_loaded_at") !== undefined;
}
