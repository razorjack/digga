-- Stable event identities let histories from overlapping backups merge without duplicates.
ALTER TABLE listen_log ADD COLUMN event_id TEXT;
ALTER TABLE verdict_log ADD COLUMN event_id TEXT;
ALTER TABLE track_mark_log ADD COLUMN event_id TEXT;
UPDATE listen_log SET event_id = lower(hex(randomblob(16)));
UPDATE verdict_log SET event_id = lower(hex(randomblob(16)));
UPDATE track_mark_log SET event_id = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX listen_event_id ON listen_log(event_id);
CREATE UNIQUE INDEX verdict_event_id ON verdict_log(event_id);
CREATE UNIQUE INDEX track_mark_event_id ON track_mark_log(event_id);
CREATE TRIGGER listen_event AFTER INSERT ON listen_log WHEN NEW.event_id IS NULL
BEGIN
  UPDATE listen_log SET event_id = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER verdict_event AFTER INSERT ON verdict_log WHEN NEW.event_id IS NULL
BEGIN
  UPDATE verdict_log SET event_id = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER track_mark_event AFTER INSERT ON track_mark_log WHEN NEW.event_id IS NULL
BEGIN
  UPDATE track_mark_log SET event_id = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

DROP TRIGGER verdict_log_insert;
CREATE TRIGGER verdict_log_insert AFTER INSERT ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, notes, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.key, NEW.status, NEW.source,
    NEW.notes, NEW.release_id, NEW.decided_at);
END;

DROP TRIGGER verdict_log_update;
CREATE TRIGGER verdict_log_update AFTER UPDATE ON verdicts
WHEN (OLD.key IS NOT NEW.key OR OLD.status IS NOT NEW.status OR OLD.source IS NOT NEW.source
  OR OLD.notes IS NOT NEW.notes OR OLD.release_id IS NOT NEW.release_id
  OR OLD.decided_at IS NOT NEW.decided_at) AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, previous_key, status, source, notes, release_id,
    decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.key,
    CASE WHEN OLD.key IS NOT NEW.key THEN OLD.key END, NEW.status, NEW.source, NEW.notes,
    NEW.release_id, NEW.decided_at);
END;

DROP TRIGGER verdict_log_delete;
CREATE TRIGGER verdict_log_delete AFTER DELETE ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, notes, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.key, OLD.status, OLD.source,
    OLD.notes, OLD.release_id, OLD.decided_at);
END;

DROP TRIGGER track_mark_log_insert;
CREATE TRIGGER track_mark_log_insert AFTER INSERT ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

DROP TRIGGER track_mark_log_update;
CREATE TRIGGER track_mark_log_update AFTER UPDATE ON track_verdicts
WHEN (OLD.mark IS NOT NEW.mark OR OLD.notes IS NOT NEW.notes OR OLD.decided_at IS NOT NEW.decided_at
  OR OLD.heard_key IS NOT NEW.heard_key OR OLD.artist_display IS NOT NEW.artist_display
  OR OLD.title IS NOT NEW.title OR OLD.video_id IS NOT NEW.video_id
  OR OLD.at_seconds IS NOT NEW.at_seconds) AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.release_id, NEW.position, NEW.mark,
    NEW.notes, NEW.decided_at, NEW.heard_key, NEW.artist_display, NEW.title, NEW.video_id,
    NEW.at_seconds);
END;

DROP TRIGGER track_mark_log_delete;
CREATE TRIGGER track_mark_log_delete AFTER DELETE ON track_verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO track_mark_log (at, change, release_id, position, mark, notes, decided_at, heard_key,
    artist_display, title, video_id, at_seconds)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.release_id, OLD.position, OLD.mark,
    OLD.notes, OLD.decided_at, OLD.heard_key, OLD.artist_display, OLD.title, OLD.video_id,
    OLD.at_seconds);
END;
