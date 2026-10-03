import type { BackedUpData } from "../../shared/decisions-backup.ts";
import { HISTORY_SCHEMAS } from "../../shared/history-backup.ts";
import type { Db } from "./db.ts";

type HistorySection = keyof typeof HISTORY_SCHEMAS;
type History = Pick<BackedUpData, HistorySection>;

const EVENT_ORDER = "ORDER BY at, event_id";
const KEEP_EXISTING_EVENT = "ON CONFLICT(event_id) DO NOTHING";

/**
 * Where each history section lives, the order it is read in, and how a restored row meets one the
 * library has: events are kept once, a release note keeps the newer edit.
 */
const TABLES: Record<HistorySection, { table: string; order: string; conflict: string }> = {
  releaseNotes: {
    table: "release_notes",
    order: "ORDER BY release_id",
    conflict: `ON CONFLICT(release_id) DO UPDATE SET
      notes = excluded.notes, updated_at = excluded.updated_at
      WHERE excluded.updated_at > release_notes.updated_at`,
  },
  listenLog: { table: "listen_log", order: EVENT_ORDER, conflict: KEEP_EXISTING_EVENT },
  verdictLog: { table: "verdict_log", order: EVENT_ORDER, conflict: KEEP_EXISTING_EVENT },
  trackMarkLog: { table: "track_mark_log", order: EVENT_ORDER, conflict: KEEP_EXISTING_EVENT },
};

export function readHistory(db: Db): History {
  return {
    releaseNotes: readSection(db, "releaseNotes"),
    listenLog: readSection(db, "listenLog"),
    verdictLog: readSection(db, "verdictLog"),
    trackMarkLog: readSection(db, "trackMarkLog"),
  };
}

/** Table and column names come only from the schemas and the table above, never from backup input. */
export function restoreHistory(db: Db, history: History): void {
  for (const section of Object.keys(TABLES) as HistorySection[]) {
    const { table, conflict } = TABLES[section];
    const columns = Object.keys(HISTORY_SCHEMAS[section].shape);
    const values = columns.map((column) => `@${column}`);
    const insert = db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")}) ${conflict}`,
    );
    for (const row of history[section]) insert.run(row);
  }
}

function readSection<Section extends HistorySection>(db: Db, section: Section): History[Section] {
  const { table, order } = TABLES[section];
  const rows = db.prepare(`SELECT * FROM ${table} ${order}`).all();
  return HISTORY_SCHEMAS[section].array().parse(rows) as History[Section];
}
