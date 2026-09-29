-- Each dump load, so a load can say what changed and the releases it added can be dug on their own.
CREATE TABLE dump_loads (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  dump_date TEXT,
  started_at TEXT NOT NULL,
  -- Null while the load runs, and for a load that failed or was cancelled.
  finished_at TEXT,
  -- Releases the load brought into the universe: new to Digga, or stubs it loaded.
  added INTEGER,
  -- Releases kept because of their label or artist rather than their style.
  coverage INTEGER,
  -- Universe releases the load did not find; null for a load stopped by a limit.
  missing INTEGER
);

-- The load that brought the release into the universe; null for stubs and for releases loaded
-- before Digga recorded loads.
ALTER TABLE releases ADD COLUMN added_by_load INTEGER REFERENCES dump_loads (id);
CREATE INDEX releases_added_by_load ON releases (added_by_load);

-- The newest load that wrote the release, so a load can tell which releases it did not find.
ALTER TABLE releases ADD COLUMN written_by_load INTEGER REFERENCES dump_loads (id);
