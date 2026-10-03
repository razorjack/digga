-- A mark is identified by its release and tune; the position only says where the tune is now, and
-- may be empty or shared. A mark saved without its tune takes the release and position as one.
CREATE TABLE track_verdicts_by_tune (
  release_id INTEGER NOT NULL,
  heard_key TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  mark TEXT NOT NULL,
  notes TEXT,
  decided_at TEXT NOT NULL,
  artist_display TEXT,
  title TEXT,
  video_id TEXT,
  at_seconds REAL,
  PRIMARY KEY (release_id, heard_key)
);

INSERT OR IGNORE INTO track_verdicts_by_tune (release_id, heard_key, position, mark, notes,
  decided_at, artist_display, title, video_id, at_seconds)
SELECT release_id, COALESCE(heard_key, 'r:' || release_id || ' ' || position), position, mark,
  notes, decided_at, artist_display, title, video_id, at_seconds
FROM track_verdicts ORDER BY decided_at DESC;

DROP TABLE track_verdicts;
ALTER TABLE track_verdicts_by_tune RENAME TO track_verdicts;

CREATE TRIGGER track_mark_log_insert AFTER INSERT ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

CREATE TRIGGER track_mark_log_update AFTER UPDATE ON track_verdicts
WHEN (OLD.mark IS NOT NEW.mark OR OLD.notes IS NOT NEW.notes OR OLD.decided_at IS NOT NEW.decided_at
  OR OLD.heard_key IS NOT NEW.heard_key OR OLD.position IS NOT NEW.position
  OR OLD.artist_display IS NOT NEW.artist_display OR OLD.title IS NOT NEW.title
  OR OLD.video_id IS NOT NEW.video_id OR OLD.at_seconds IS NOT NEW.at_seconds)
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

CREATE TRIGGER track_mark_log_delete AFTER DELETE ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.release_id, OLD.position, OLD.mark,
    OLD.notes, OLD.decided_at, OLD.heard_key, OLD.artist_display, OLD.title, OLD.video_id,
    OLD.at_seconds);
END;
