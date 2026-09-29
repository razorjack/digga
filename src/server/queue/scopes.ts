import type { ScopeMatch } from "../../shared/api.ts";
import type { ScopeKind } from "../../shared/scope.ts";
import type { Db } from "../db/db.ts";
import { escapeLike } from "./query.ts";

interface MatchRow {
  credit_id: number;
  credit_name: string;
  records: number;
}

const LABEL_SEARCH = `
SELECT json_extract(l.value, '$.id') AS credit_id, json_extract(l.value, '$.name') AS credit_name,
       COUNT(DISTINCT r.triage_key) AS records
FROM releases r, json_each(r.labels_json) l
WHERE r.in_universe = 1 AND json_extract(l.value, '$.name') LIKE ? ESCAPE '\\'
GROUP BY credit_id HAVING credit_id > 0
ORDER BY records DESC, credit_name COLLATE NOCASE
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
SELECT json_extract(artist, '$.id') AS credit_id, json_extract(artist, '$.name') AS credit_name,
       COUNT(DISTINCT triage_key) AS records
FROM credits
WHERE json_extract(artist, '$.name') LIKE ? ESCAPE '\\'
GROUP BY credit_id HAVING credit_id > 0 AND credit_id <> 194
ORDER BY records DESC, credit_name COLLATE NOCASE
LIMIT ?`;

/**
 * Labels and artists in the universe whose name contains the text, most records first. The
 * count covers every loaded record of theirs, before filters and verdicts.
 */
export function searchScopes(db: Db, text: string, limit = 12): ScopeMatch[] {
  const pattern = `%${escapeLike(text)}%`;
  const labels = db.prepare(LABEL_SEARCH).all(pattern, limit) as MatchRow[];
  const artists = db.prepare(ARTIST_SEARCH).all(pattern, limit) as MatchRow[];
  const matches = [
    ...labels.map((row) => toMatch("label", row)),
    ...artists.map((row) => toMatch("artist", row)),
  ];
  return matches.sort((left, right) => right.records - left.records).slice(0, limit);
}

function toMatch(kind: ScopeKind, row: MatchRow): ScopeMatch {
  return { kind, id: row.credit_id, name: row.credit_name, records: row.records };
}
