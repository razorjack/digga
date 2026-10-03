-- What the Discogs account holds (collection, wantlist, Maybe list) is no longer a verdict that
-- competes with the user's own decision by rank: it lives in memberships, and verdicts keep only
-- decisions made in Digga and browser-history hits. Notes belong to releases (release_notes).
-- The restoring flag keeps the log and note triggers from recording these rewrites as decisions.
INSERT INTO meta (key, value) VALUES ('restoring_decisions', '1');

-- A row per release the account holds: date_added, rating and notes as Discogs sent them.
-- removed_at is set when an import no longer lists the release; null while Discogs has it.
CREATE TABLE memberships (
  kind TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  master_id INTEGER,
  date_added TEXT,
  rating INTEGER,
  notes TEXT,
  added_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (kind, release_id)
);
CREATE INDEX memberships_release ON memberships (release_id);

INSERT INTO memberships (kind, release_id, master_id, date_added, rating, notes, added_at,
  imported_at)
SELECT kind, release_id, master_id, date_added, rating, notes, imported_at, imported_at
FROM seed_items;

-- Maybe-list items were maybe verdicts from seed:list. One without a release (a master the list
-- import could not look up) has nothing to hold; the next list import finds it again.
INSERT INTO memberships (kind, release_id, master_id, notes, added_at, imported_at)
SELECT 'list', v.release_id, r.master_id, v.notes, v.decided_at, v.decided_at
FROM verdicts v LEFT JOIN releases r ON r.id = v.release_id
WHERE v.source = 'seed:list' AND v.release_id IS NOT NULL
ON CONFLICT (kind, release_id) DO NOTHING;

-- Verdict notes were copied to release_notes as they were written; this keeps any that were not.
INSERT INTO release_notes (release_id, notes, updated_at)
SELECT release_id, notes, decided_at FROM verdicts
WHERE release_id IS NOT NULL AND notes IS NOT NULL
ON CONFLICT (release_id) DO NOTHING;

-- A seed that replaced a decision made in Digga kept its dug_at; the log has that decision.
UPDATE verdicts SET (status, source, release_id, decided_at) = (
  SELECT l.status, l.source, l.release_id, l.decided_at FROM verdict_log l
  WHERE l.key = verdicts.key AND l.source IN ('triage', 'manual') AND l.change <> 'delete'
  ORDER BY l.id DESC LIMIT 1)
WHERE source IN ('seed:collection', 'seed:wantlist', 'seed:list') AND dug_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM verdict_log l
    WHERE l.key = verdicts.key AND l.source IN ('triage', 'manual') AND l.change <> 'delete');
DELETE FROM verdicts WHERE source IN ('seed:collection', 'seed:wantlist', 'seed:list');
DROP TABLE seed_items;

-- notes and dug_at go: the note is the release's, and a record is dug when it has a decision
-- made in Digga. The triggers name the columns, so they are dropped first and written again.
DROP TRIGGER verdict_note_insert;
DROP TRIGGER verdict_note_update;
DROP TRIGGER verdict_log_insert;
DROP TRIGGER verdict_log_update;
DROP TRIGGER verdict_log_delete;
DROP INDEX verdicts_dug_at;
ALTER TABLE verdicts DROP COLUMN notes;
ALTER TABLE verdicts DROP COLUMN dug_at;

-- verdict_log keeps its notes column for the rows written before; new rows leave it null.
CREATE TRIGGER verdict_log_insert AFTER INSERT ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'insert', NEW.key, NEW.status, NEW.source,
    NEW.release_id, NEW.decided_at);
END;

CREATE TRIGGER verdict_log_update AFTER UPDATE ON verdicts
WHEN (OLD.key IS NOT NEW.key OR OLD.status IS NOT NEW.status OR OLD.source IS NOT NEW.source
  OR OLD.release_id IS NOT NEW.release_id OR OLD.decided_at IS NOT NEW.decided_at)
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, previous_key, status, source, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'update', NEW.key,
    CASE WHEN OLD.key IS NOT NEW.key THEN OLD.key END, NEW.status, NEW.source, NEW.release_id,
    NEW.decided_at);
END;

CREATE TRIGGER verdict_log_delete AFTER DELETE ON verdicts
WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO verdict_log (at, change, key, status, source, release_id, decided_at)
  VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'delete', OLD.key, OLD.status, OLD.source,
    OLD.release_id, OLD.decided_at);
END;

DELETE FROM meta WHERE key = 'restoring_decisions';
