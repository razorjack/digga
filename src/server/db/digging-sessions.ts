import {
  sessionFromRow,
  SessionRowSchema,
  type SavedSession,
  type SessionInput,
  type SessionRow,
} from "../../shared/digging-session.ts";
import type { Config } from "../../shared/config.ts";
import { type Db, getMeta, nowIso } from "./db.ts";

export function saveSession(db: Db, input: SessionInput, config: Config): void {
  db.prepare(`INSERT INTO digging_sessions
    (id, started_at, updated_at, config_json, dump_date, schema_version, state_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, state_json = excluded.state_json`).run(
    input.id,
    input.startedAt,
    nowIso(),
    JSON.stringify(config),
    getMeta(db, "dump_date") ?? null,
    Number(getMeta(db, "schema_version")),
    JSON.stringify(input.state),
  );
}

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

export function restoreSessions(db: Db, rows: SessionRow[]): void {
  const insert = db.prepare(`INSERT INTO digging_sessions
    (id, started_at, updated_at, config_json, dump_date, schema_version, state_json)
    VALUES (@id, @started_at, @updated_at, @config_json, @dump_date, @schema_version, @state_json)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, state_json = excluded.state_json
    WHERE excluded.updated_at > digging_sessions.updated_at`);
  for (const row of rows) {
    sessionFromRow(row);
    insert.run(row);
  }
}
