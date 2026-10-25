-- The labels and artists credited on each release, its tracks' artists included, so a label or
-- artist scope reads the releases it names instead of every release's JSON credits.
CREATE TABLE release_credits (
  kind TEXT NOT NULL CHECK (kind IN ('label', 'artist')),
  credit_id INTEGER NOT NULL,
  release_id INTEGER NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  PRIMARY KEY (kind, credit_id, release_id)
) WITHOUT ROWID;
CREATE INDEX release_credits_release ON release_credits (release_id);

INSERT OR IGNORE INTO release_credits (kind, credit_id, release_id)
SELECT 'label', json_extract(l.value, '$.id'), r.id
FROM releases r, json_each(r.labels_json) l
WHERE json_extract(l.value, '$.id') IS NOT NULL;

INSERT OR IGNORE INTO release_credits (kind, credit_id, release_id)
SELECT 'artist', json_extract(a.value, '$.id'), r.id
FROM releases r, json_each(r.artists_json) a
WHERE json_extract(a.value, '$.id') IS NOT NULL;

INSERT OR IGNORE INTO release_credits (kind, credit_id, release_id)
SELECT 'artist', json_extract(a.value, '$.id'), t.release_id
FROM tracks t, json_each(t.artists_json) a
WHERE json_extract(a.value, '$.id') IS NOT NULL;
