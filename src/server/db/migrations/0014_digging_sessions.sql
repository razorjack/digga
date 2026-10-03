CREATE TABLE digging_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  config_json TEXT NOT NULL,
  dump_date TEXT,
  schema_version INTEGER NOT NULL,
  state_json TEXT NOT NULL
);
CREATE INDEX digging_sessions_updated ON digging_sessions(updated_at);
