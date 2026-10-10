import type { ScopeMatch } from "../../shared/api.ts";
import type { ScopeKind } from "../../shared/scope.ts";
import { normalizeText } from "../../shared/normalize.ts";
import type { Db } from "../db/db.ts";
import { scopeNamesFresh } from "../db/scope-names.ts";
import { escapeLike } from "./query.ts";

interface MatchRow {
  match_id: number;
  match_name: string;
  records: number;
}

type NameRow = MatchRow & { kind: "label" | "artist" };

const LABEL_SEARCH = `
SELECT json_extract(l.value, '$.id') AS match_id, json_extract(l.value, '$.name') AS match_name,
       COUNT(DISTINCT r.triage_key) AS records
FROM releases r, json_each(r.labels_json) l
WHERE r.in_universe = 1 AND json_extract(l.value, '$.name') LIKE ? ESCAPE '\\'
GROUP BY match_id HAVING match_id > 0
ORDER BY records DESC, match_name COLLATE NOCASE
LIMIT ?`;

// Credits on tracks count too, as in the artist scope; 194 is Discogs' "Various".
const ARTIST_SEARCH = `
WITH credits AS (
  SELECT r.triage_key, a.value AS artist
  FROM releases r, json_each(r.artists_json) a
  WHERE r.in_universe = 1
  UNION ALL
  SELECT r.triage_key, a.value
  FROM releases r JOIN tracks t ON t.release_id = r.id, json_each(t.artists_json) a
  WHERE r.in_universe = 1
)
SELECT json_extract(artist, '$.id') AS match_id, json_extract(artist, '$.name') AS match_name,
       COUNT(DISTINCT triage_key) AS records
FROM credits
WHERE json_extract(artist, '$.name') LIKE ? ESCAPE '\\'
GROUP BY match_id HAVING match_id > 0 AND match_id <> 194
ORDER BY records DESC, match_name COLLATE NOCASE
LIMIT ?`;

// A seller whose shop was read, with none of it loaded, still matches with 0 records.
const SELLER_SEARCH = `
SELECT s.id AS match_id, s.username AS match_name, COUNT(DISTINCT r.triage_key) AS records
FROM sellers s
LEFT JOIN seller_releases sr ON sr.seller_id = s.id
LEFT JOIN releases r ON r.id = sr.release_id AND r.in_universe = 1
WHERE s.username LIKE ? ESCAPE '\\'
GROUP BY s.id
ORDER BY records DESC, s.username COLLATE NOCASE
LIMIT ?`;

// Names and text are folded alike, so "bjork" and "BJÖRK" find Björk.
const NAME_SEARCH = `
SELECT kind, id AS match_id, name AS match_name, records
FROM scope_names
WHERE search_name LIKE ? ESCAPE '\\'
ORDER BY records DESC, name COLLATE NOCASE
LIMIT ?`;

/**
 * Sellers whose shop Digga has read, then labels and artists in the universe, whose name
 * contains the text. Sellers come first because there are few and their names are typed on
 * purpose; the others are ordered by records. A count covers every loaded record, before
 * filters and verdicts.
 */
export function searchScopes(db: Db, text: string, limit = 12): ScopeMatch[] {
  const sellers = db.prepare(SELLER_SEARCH).all(`%${escapeLike(text)}%`, limit) as MatchRow[];
  const credits = scopeNamesFresh(db)
    ? searchNames(db, text, limit)
    : searchReleases(db, text, limit);
  return [...sellers.map((row) => toMatch("seller", row)), ...credits].slice(0, limit);
}

function searchNames(db: Db, text: string, limit: number): ScopeMatch[] {
  const folded = normalizeText(text);
  if (folded === "") return [];
  const rows = db.prepare(NAME_SEARCH).all(`%${escapeLike(folded)}%`, limit) as NameRow[];
  return rows.map((row) => toMatch(row.kind, row));
}

/** While a load changes the universe, the credits are read from the releases themselves. */
function searchReleases(db: Db, text: string, limit: number): ScopeMatch[] {
  const pattern = `%${escapeLike(text)}%`;
  const labels = db.prepare(LABEL_SEARCH).all(pattern, limit) as MatchRow[];
  const artists = db.prepare(ARTIST_SEARCH).all(pattern, limit) as MatchRow[];
  return [
    ...labels.map((row) => toMatch("label", row)),
    ...artists.map((row) => toMatch("artist", row)),
  ].sort((left, right) => right.records - left.records);
}

function toMatch(kind: ScopeKind, row: MatchRow): ScopeMatch {
  return { kind, id: row.match_id, name: row.match_name, records: row.records };
}
