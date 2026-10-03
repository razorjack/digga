-- When a row last changed, apart from when its decision was made: a note edit or an undo changes
-- a row without a new decision. Restore keeps whichever side changed last (F04). The logs record
-- it too, so they hold every column of the rows they describe.
ALTER TABLE verdicts ADD COLUMN updated_at TEXT;
UPDATE verdicts SET updated_at = max(decided_at, COALESCE(
  (SELECT MAX(l.at) FROM verdict_log l WHERE l.key = verdicts.key AND l.change <> 'existing'),
  decided_at));

ALTER TABLE track_verdicts ADD COLUMN updated_at TEXT;
UPDATE track_verdicts SET updated_at = max(decided_at, COALESCE(
  (SELECT MAX(l.at) FROM track_mark_log l
   WHERE l.release_id = track_verdicts.release_id AND l.heard_key = track_verdicts.heard_key
     AND l.change <> 'existing'),
  decided_at));

ALTER TABLE verdict_log ADD COLUMN updated_at TEXT;
ALTER TABLE track_mark_log ADD COLUMN updated_at TEXT;
CREATE INDEX track_mark_log_tune ON track_mark_log (release_id, heard_key);

DROP TRIGGER verdict_log_insert;
DROP TRIGGER verdict_log_update;
DROP TRIGGER verdict_log_delete;
DROP TRIGGER track_mark_log_insert;
DROP TRIGGER track_mark_log_update;
DROP TRIGGER track_mark_log_delete;

CREATE TRIGGER verdict_log_insert AFTER INSERT ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, release_id, decided_at, updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.key, NEW.status, NEW.source,
    NEW.release_id, NEW.decided_at, NEW.updated_at);
END;

CREATE TRIGGER verdict_log_update AFTER UPDATE ON verdicts
WHEN (OLD.key IS NOT NEW.key OR OLD.status IS NOT NEW.status OR OLD.source IS NOT NEW.source
  OR OLD.release_id IS NOT NEW.release_id OR OLD.decided_at IS NOT NEW.decided_at
  OR OLD.updated_at IS NOT NEW.updated_at)
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, previous_key, status, source, release_id, decided_at,
    updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.key,
    CASE WHEN OLD.key IS NOT NEW.key THEN OLD.key END, NEW.status, NEW.source, NEW.release_id,
    NEW.decided_at, NEW.updated_at);
END;

CREATE TRIGGER verdict_log_delete AFTER DELETE ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, release_id, decided_at, updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.key, OLD.status, OLD.source,
    OLD.release_id, OLD.decided_at, OLD.updated_at);
END;

CREATE TRIGGER track_mark_log_insert AFTER INSERT ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds, updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds, NEW.updated_at);
END;

CREATE TRIGGER track_mark_log_update AFTER UPDATE ON track_verdicts
WHEN (OLD.mark IS NOT NEW.mark OR OLD.notes IS NOT NEW.notes OR OLD.decided_at IS NOT NEW.decided_at
  OR OLD.heard_key IS NOT NEW.heard_key OR OLD.position IS NOT NEW.position
  OR OLD.artist_display IS NOT NEW.artist_display OR OLD.title IS NOT NEW.title
  OR OLD.video_id IS NOT NEW.video_id OR OLD.at_seconds IS NOT NEW.at_seconds
  OR OLD.updated_at IS NOT NEW.updated_at)
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds, updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds, NEW.updated_at);
END;

CREATE TRIGGER track_mark_log_delete AFTER DELETE ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds, updated_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.release_id, OLD.position, OLD.mark,
    OLD.notes, OLD.decided_at, OLD.heard_key, OLD.artist_display, OLD.title, OLD.video_id,
    OLD.at_seconds, OLD.updated_at);
END;
