import { normalizeText } from "../../shared/normalize.ts";
import type { Db } from "./db.ts";

/** Set while scope_names matches the universe; a load clears it as it starts writing. */
const FRESH_KEY = "scope_names_fresh";

interface CreditRow {
  kind: "label" | "artist";
  scope_id: number;
  name: string;
  records: number;
}

const LABEL_CREDITS = `
SELECT 'label' AS kind, json_extract(l.value, '$.id') AS scope_id, COALESCE(json_extract(l.value, '$.name'), '') AS name,
       COUNT(DISTINCT r.triage_key) AS records
FROM releases r, json_each(r.labels_json) l
WHERE r.in_universe = 1
GROUP BY scope_id HAVING scope_id > 0`;

// Credits on tracks count too, as in the artist scope; 194 is Discogs' "Various".
const ARTIST_CREDITS = `
WITH credits AS (
  SELECT r.triage_key, a.value AS artist
  FROM releases r, json_each(r.artists_json) a
  WHERE r.in_universe = 1
  UNION ALL
  SELECT r.triage_key, a.value
  FROM releases r JOIN tracks t ON t.release_id = r.id, json_each(t.artists_json) a
  WHERE r.in_universe = 1
)
SELECT 'artist' AS kind, json_extract(artist, '$.id') AS scope_id, COALESCE(json_extract(artist, '$.name'), '') AS name,
       COUNT(DISTINCT triage_key) AS records
FROM credits
GROUP BY scope_id HAVING scope_id > 0 AND scope_id <> 194`;

export function scopeNamesFresh(db: Db): boolean {
  return db.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(FRESH_KEY) === "1";
}

/** The universe is about to change; searches read the releases until the next rebuild. */
export function markScopeNamesStale(db: Db): void {
  db.prepare("DELETE FROM meta WHERE key = ?").run(FRESH_KEY);
}

/** Every label and artist in the universe with its records, as a search reads them. */
export function rebuildScopeNames(db: Db): void {
  const credits = [
    ...(db.prepare(LABEL_CREDITS).all() as CreditRow[]),
    ...(db.prepare(ARTIST_CREDITS).all() as CreditRow[]),
  ];
  const insert = db.prepare(
    "INSERT INTO scope_names (kind, id, name, search_name, records) VALUES (?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    db.prepare("DELETE FROM scope_names").run();
    for (const credit of credits)
      insert.run(
        credit.kind,
        credit.scope_id,
        credit.name,
        normalizeText(credit.name),
        credit.records,
      );
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").run(FRESH_KEY);
  })();
}

/** A library opened after a crash during a load, or before scope_names existed, rebuilds it. */
export function ensureScopeNames(db: Db): void {
  if (!scopeNamesFresh(db)) rebuildScopeNames(db);
}
