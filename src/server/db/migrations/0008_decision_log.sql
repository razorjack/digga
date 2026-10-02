-- Every change to a verdict or a track mark. The tables hold only the latest decision, and imports,
-- re-judging in Twelves, undo and dump loads replace or delete decisions made in Digga. Triggers
-- write the log, so no code path that changes a decision can leave it out.

-- `change` is 'existing' for the rows the log started from, then 'insert', 'update' or 'delete'.
-- The other columns hold the row after the change; for a delete, the row that was deleted.
CREATE TABLE verdict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  change TEXT NOT NULL,
  key TEXT NOT NULL,
  -- The key an update moved the verdict from; null when the key stayed.
  previous_key TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  notes TEXT,
  release_id INTEGER,
  decided_at TEXT NOT NULL
);
CREATE INDEX verdict_log_key ON verdict_log (key);

CREATE TABLE track_mark_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  change TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  position TEXT NOT NULL,
  mark TEXT NOT NULL,
  notes TEXT,
  decided_at TEXT NOT NULL,
  heard_key TEXT,
  artist_display TEXT,
  title TEXT,
  video_id TEXT,
  at_seconds REAL
);
CREATE INDEX track_mark_log_release ON track_mark_log (release_id, position);

INSERT INTO verdict_log (at, change, key, status, source, notes, release_id, decided_at)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'existing', key, status, source, notes, release_id,
  decided_at
FROM verdicts ORDER BY decided_at, key;

INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
  artist_display, title, video_id, at_seconds)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'existing', release_id, position, mark, notes,
  decided_at, heard_key, artist_display, title, video_id, at_seconds
FROM track_verdicts ORDER BY decided_at, release_id, position;

CREATE TRIGGER verdict_log_insert AFTER INSERT ON verdicts
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, notes, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.key, NEW.status, NEW.source,
    NEW.notes, NEW.release_id, NEW.decided_at);
END;

-- An upsert that writes the values the row has already is not a change.
CREATE TRIGGER verdict_log_update AFTER UPDATE ON verdicts
WHEN OLD.key IS NOT NEW.key OR OLD.status IS NOT NEW.status OR OLD.source IS NOT NEW.source
  OR OLD.notes IS NOT NEW.notes OR OLD.release_id IS NOT NEW.release_id
  OR OLD.decided_at IS NOT NEW.decided_at
BEGIN
  INSERT INTO verdict_log (at, change, key, previous_key, status, source, notes, release_id,
    decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.key,
    CASE WHEN OLD.key IS NOT NEW.key THEN OLD.key END, NEW.status, NEW.source, NEW.notes,
    NEW.release_id, NEW.decided_at);
END;

CREATE TRIGGER verdict_log_delete AFTER DELETE ON verdicts
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, notes, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.key, OLD.status, OLD.source,
    OLD.notes, OLD.release_id, OLD.decided_at);
END;

CREATE TRIGGER track_mark_log_insert AFTER INSERT ON track_verdicts
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

CREATE TRIGGER track_mark_log_update AFTER UPDATE ON track_verdicts
WHEN OLD.mark IS NOT NEW.mark OR OLD.notes IS NOT NEW.notes OR OLD.decided_at IS NOT NEW.decided_at
  OR OLD.heard_key IS NOT NEW.heard_key OR OLD.artist_display IS NOT NEW.artist_display
  OR OLD.title IS NOT NEW.title OR OLD.video_id IS NOT NEW.video_id
  OR OLD.at_seconds IS NOT NEW.at_seconds
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

CREATE TRIGGER track_mark_log_delete AFTER DELETE ON track_verdicts
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.release_id, OLD.position, OLD.mark,
    OLD.notes, OLD.decided_at, OLD.heard_key, OLD.artist_display, OLD.title, OLD.video_id,
    OLD.at_seconds);
END;
