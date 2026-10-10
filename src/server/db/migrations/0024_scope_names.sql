-- The labels and artists Triage's F finds: how many records each has in the universe, and the
-- name folded as normalizeText() folds it, so a search reads one small table instead of every
-- release's credits. A load rebuilds it as it ends; until then the search reads the releases.
CREATE TABLE scope_names (
  kind TEXT NOT NULL CHECK (kind IN ('label', 'artist')),
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  records INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
) WITHOUT ROWID;
-- A search walks the names most records first and stops at its limit.
CREATE INDEX scope_names_by_records ON scope_names (records DESC, name COLLATE NOCASE);
