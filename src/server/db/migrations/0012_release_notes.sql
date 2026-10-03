CREATE TABLE release_notes (
  release_id INTEGER PRIMARY KEY,
  notes TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR REPLACE INTO release_notes SELECT release_id, notes, decided_at FROM verdicts
WHERE release_id IS NOT NULL AND notes IS NOT NULL ORDER BY decided_at;

CREATE TRIGGER verdict_note_insert AFTER INSERT ON verdicts
WHEN NEW.release_id IS NOT NULL AND NEW.notes IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO release_notes VALUES (NEW.release_id, NEW.notes, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
  WHERE release_notes.notes IS NOT excluded.notes;
END;
CREATE TRIGGER verdict_note_update AFTER UPDATE ON verdicts
WHEN NEW.release_id IS NOT NULL AND (OLD.notes IS NOT NEW.notes OR OLD.release_id IS NOT NEW.release_id)
  AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'restoring_decisions')
BEGIN
  INSERT INTO release_notes VALUES (NEW.release_id, NEW.notes, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
  WHERE release_notes.notes IS NOT excluded.notes;
END;
