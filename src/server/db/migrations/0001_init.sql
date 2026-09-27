-- Digga schema v1. Never edit applied migrations; add a new numbered file.

CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  master_id INTEGER,
  is_main_release INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  artists_json TEXT NOT NULL DEFAULT '[]',
  artist_display TEXT NOT NULL DEFAULT '',
  labels_json TEXT NOT NULL DEFAULT '[]',
  label_name TEXT,
  catno TEXT,
  year INTEGER,
  released_raw TEXT,
  country TEXT,
  formats_json TEXT NOT NULL DEFAULT '[]',
  is_vinyl INTEGER NOT NULL DEFAULT 0,
  genres_json TEXT NOT NULL DEFAULT '[]',
  styles_json TEXT NOT NULL DEFAULT '[]',
  in_universe INTEGER NOT NULL DEFAULT 1,
  -- Computed by triageKeyFor() in application code: m:{master_id} or r:{id}.
  triage_key TEXT NOT NULL,
  -- API snapshot (filled by enrich).
  lowest_price REAL,
  num_for_sale INTEGER,
  currency TEXT,
  community_have INTEGER,
  community_want INTEGER,
  enriched_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX releases_triage_key ON releases (triage_key);
CREATE INDEX releases_master_id ON releases (master_id);
CREATE INDEX releases_label_sweep ON releases (label_name COLLATE NOCASE, catno COLLATE NOCASE);
CREATE INDEX releases_year ON releases (year);
CREATE INDEX releases_country ON releases (country);
CREATE INDEX releases_universe ON releases (in_universe);

CREATE TABLE tracks (
  release_id INTEGER NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  artists_json TEXT NOT NULL DEFAULT '[]',
  artist_display TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  heard_key TEXT NOT NULL,
  PRIMARY KEY (release_id, seq)
);
CREATE INDEX tracks_heard_key ON tracks (heard_key);

CREATE TABLE videos (
  release_id INTEGER NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  src TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  embeddable INTEGER NOT NULL DEFAULT 1,
  matched_position TEXT,
  PRIMARY KEY (release_id, video_id)
);

CREATE TABLE verdicts (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  notes TEXT,
  release_id INTEGER,
  decided_at TEXT NOT NULL
);
CREATE INDEX verdicts_status ON verdicts (status);
CREATE INDEX verdicts_decided_at ON verdicts (decided_at);

CREATE TABLE track_verdicts (
  release_id INTEGER NOT NULL,
  position TEXT NOT NULL,
  mark TEXT NOT NULL,
  notes TEXT,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (release_id, position)
);

CREATE TABLE heard_tracks (
  heard_key TEXT PRIMARY KEY,
  first_release_id INTEGER NOT NULL,
  seconds_listened REAL NOT NULL DEFAULT 0,
  first_heard_at TEXT NOT NULL,
  last_heard_at TEXT NOT NULL
);

CREATE TABLE listen_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL,
  position TEXT,
  video_id TEXT NOT NULL,
  seconds REAL NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX listen_log_release ON listen_log (release_id);

-- Raw Discogs seed rows (collection / wantlist items) with their date_added.
CREATE TABLE seed_items (
  kind TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  master_id INTEGER,
  date_added TEXT,
  rating INTEGER,
  notes TEXT,
  basic_information_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (kind, release_id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX jobs_created_at ON jobs (created_at);
