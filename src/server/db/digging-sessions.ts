import type { Config } from "../../shared/config.ts";
import {
  sessionFromRow,
  SessionRowSchema,
  type SavedSession,
  type SessionInput,
  type SessionRow,
} from "../../shared/digging-session.ts";
import { type Db, getMeta, nowIso } from "./db.ts";

const INSERT_SESSION = `INSERT INTO digging_sessions
    (id, started_at, updated_at, config_json, dump_date, schema_version, state_json)
  VALUES (@id, @started_at, @updated_at, @config_json, @dump_date, @schema_version, @state_json)
  ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, state_json = excluded.state_json`;

/**
 * Saves where the session is now. The settings, catalogue date and schema version are those the
 * session started with; later saves only move its state.
 */
export function saveSession(db: Db, input: SessionInput, config: Config): void {
  const row: SessionRow = {
    id: input.id,
    started_at: input.startedAt,
    updated_at: nowIso(),
    config_json: JSON.stringify(config),
    dump_date: getMeta(db, "dump_date") ?? null,
    schema_version: Number(getMeta(db, "schema_version")),
    state_json: JSON.stringify(input.state),
  };
  db.prepare(INSERT_SESSION).run(row);
}

/** The newest saved session; null when there is none or this version cannot resume it. */
export function latestSession(db: Db): SavedSession | null {
  const row = db
    .prepare("SELECT * FROM digging_sessions ORDER BY updated_at DESC, id DESC LIMIT 1")
    .get();
  return row ? sessionFromRow(SessionRowSchema.parse(row)) : null;
}

export function getSession(db: Db, id: string): SavedSession | null {
  const row = db.prepare("SELECT * FROM digging_sessions WHERE id = ?").get(id);
  return row ? sessionFromRow(SessionRowSchema.parse(row)) : null;
}

export function readSessions(db: Db): SessionRow[] {
  return SessionRowSchema.array().parse(
    db.prepare("SELECT * FROM digging_sessions ORDER BY started_at, id").all(),
  );
}

/**
 * Adds backed-up sessions; a session the library saved later keeps its own state. Sessions this
 * version cannot resume are left out, so they never block restoring the decisions.
 */
export function restoreSessions(db: Db, rows: SessionRow[]): { restored: number; leftOut: number } {
  const insert = db.prepare(`${INSERT_SESSION}
    WHERE excluded.updated_at > digging_sessions.updated_at`);
  const outcome = { restored: 0, leftOut: 0 };
  for (const row of rows) {
    if (sessionFromRow(row) === null) outcome.leftOut += 1;
    else outcome.restored += insert.run(row).changes;
  }
  return outcome;
}
