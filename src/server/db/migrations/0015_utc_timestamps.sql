-- Seed verdicts kept Discogs' date_added as it came, with its time-zone offset
-- (2026-09-22T14:48:52-07:00) or as a bare date, while Digga writes UTC with Z, and SQL orders
-- these columns as text. The restoring flag keeps the log triggers from recording a format change
-- as a decision. seed_items.date_added stays as Discogs sent it.
INSERT INTO meta (key, value) VALUES ('restoring_decisions', '1');

UPDATE verdicts SET decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)
WHERE decided_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)
  AND strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) IS NOT NULL;

UPDATE verdicts SET dug_at = strftime('%Y-%m-%dT%H:%M:%fZ', dug_at)
WHERE dug_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', dug_at)
  AND strftime('%Y-%m-%dT%H:%M:%fZ', dug_at) IS NOT NULL;

UPDATE verdict_log SET decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)
WHERE decided_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ', decided_at)
  AND strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) IS NOT NULL;

DELETE FROM meta WHERE key = 'restoring_decisions';
