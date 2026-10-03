import type { CoverageIds } from "../../../tools/dump/coverage.ts";
import type { Db } from "../db/db.ts";

/**
 * The coverage labels and artists are those of the records the user wants or owns: wants and
 * grails decided in Digga, and what the Discogs wantlist and collection hold. Every pressing of
 * such a record counts, stubs included, since a wanted record outside the loaded styles is what
 * the coverage pass is for.
 */
const WANTED_OR_OWNED_KEYS = `
SELECT key FROM verdicts WHERE status IN ('accepted', 'candidate')
UNION
SELECT mr.triage_key FROM memberships m JOIN releases mr ON mr.id = m.release_id
WHERE m.kind IN ('wantlist', 'collection') AND m.removed_at IS NULL`;

// Self-releases share names like "Not On Label (Artist Self-released)" and cover every style.
const COVERAGE_LABEL_IDS = `
SELECT json_extract(cl.value, '$.id') AS id
FROM releases cr, json_each(cr.labels_json) cl
WHERE cr.triage_key IN (${WANTED_OR_OWNED_KEYS})
  AND json_extract(cl.value, '$.id') > 0
  AND json_extract(cl.value, '$.name') NOT LIKE 'Not On Label%'`;

// 194 is Discogs' "Various", credited on every compilation.
const COVERAGE_ARTIST_IDS = `
SELECT json_extract(ca.value, '$.id') AS id
FROM releases cr, json_each(cr.artists_json) ca
WHERE cr.triage_key IN (${WANTED_OR_OWNED_KEYS})
  AND json_extract(ca.value, '$.id') > 0
  AND json_extract(ca.value, '$.id') <> 194
  AND json_extract(ca.value, '$.name') <> 'Unknown Artist'`;

/** Releases on a coverage label or by a coverage artist, for a query over releases `r`. */
export const ON_COVERAGE = `(EXISTS (SELECT 1 FROM json_each(r.labels_json) yl
         WHERE json_extract(yl.value, '$.id') IN (${COVERAGE_LABEL_IDS}))
       OR EXISTS (SELECT 1 FROM json_each(r.artists_json) ya
         WHERE json_extract(ya.value, '$.id') IN (${COVERAGE_ARTIST_IDS})))`;

/** The labels and artists the coverage pass keeps releases of, whatever their style. */
export function coverageIds(db: Db): CoverageIds {
  const ids = (sql: string) =>
    db.prepare(`SELECT DISTINCT id FROM (${sql}) ORDER BY id`).pluck().all() as number[];
  return { labelIds: ids(COVERAGE_LABEL_IDS), artistIds: ids(COVERAGE_ARTIST_IDS) };
}
