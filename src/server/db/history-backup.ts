import type { BackedUpData } from "../../shared/decisions-backup.ts";
import { HISTORY_SCHEMAS } from "../../shared/history-backup.ts";
import type { Db } from "./db.ts";

const TABLES = {
  listenLog: "listen_log",
  verdictLog: "verdict_log",
  trackMarkLog: "track_mark_log",
} as const;
type History = Pick<BackedUpData, keyof typeof TABLES>;

export function readHistory(db: Db): History {
  return {
    listenLog: HISTORY_SCHEMAS.listenLog
      .array()
      .parse(db.prepare("SELECT * FROM listen_log ORDER BY at, event_id").all()),
    verdictLog: HISTORY_SCHEMAS.verdictLog
      .array()
      .parse(db.prepare("SELECT * FROM verdict_log ORDER BY at, event_id").all()),
    trackMarkLog: HISTORY_SCHEMAS.trackMarkLog
      .array()
      .parse(db.prepare("SELECT * FROM track_mark_log ORDER BY at, event_id").all()),
  };
}

/** Table and column names come exclusively from the schemas above, never from backup input. */
export function restoreHistory(db: Db, history: Partial<History>): void {
  for (const section of Object.keys(TABLES) as (keyof History)[]) {
    const table = TABLES[section];
    const columns = Object.keys(HISTORY_SCHEMAS[section].shape);
    const conflict = "ON CONFLICT(event_id) DO NOTHING";
    const insert = db.prepare(`INSERT INTO ${table} (${columns.join(", ")})
      VALUES (${columns.map((column) => `@${column}`).join(", ")}) ${conflict}`);
    for (const row of history[section] ?? []) insert.run(row);
  }
}
