import type { CoverageIds } from "../../../tools/dump/coverage.ts";
import type { VerdictStatus } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";

/**
 * The coverage labels and artists are those of the records the user wants or owns: wants,
 * grails, the Discogs wantlist and the collection. Every pressing of such a record counts, stubs
 * included, since a wanted record outside the loaded styles is what the coverage pass is for.
 */
export const COVERAGE_STATUSES: VerdictStatus[] = [
  "accepted",
  "candidate",
  "wantlist",
  "collection",
];

const STATUSES = COVERAGE_STATUSES.map((status) => `'${status}'`).join(", ");

// Self-releases share names like "Not On Label (Artist Self-released)" and cover every style.
const COVERAGE_LABEL_IDS = `
SELECT json_extract(cl.value, '$.id') AS id
FROM verdicts cv JOIN releases cr ON cr.triage_key = cv.key, json_each(cr.labels_json) cl
WHERE cv.status IN (${STATUSES})
  AND json_extract(cl.value, '$.id') > 0
  AND json_extract(cl.value, '$.name') NOT LIKE 'Not On Label%'`;

// 194 is Discogs' "Various", credited on every compilation.
const COVERAGE_ARTIST_IDS = `
SELECT json_extract(ca.value, '$.id') AS id
FROM verdicts cv JOIN releases cr ON cr.triage_key = cv.key, json_each(cr.artists_json) ca
WHERE cv.status IN (${STATUSES})
  AND json_extract(ca.value, '$.id') > 0
  AND json_extract(ca.value, '$.id') <> 194
  AND json_extract(ca.value, '$.name') <> 'Unknown Artist'`;

/** The labels and artists the coverage pass keeps releases of, whatever their style. */
export function coverageIds(db: Db): CoverageIds {
  const ids = (sql: string) =>
    db.prepare(`SELECT DISTINCT id FROM (${sql}) ORDER BY id`).pluck().all() as number[];
  return { labelIds: ids(COVERAGE_LABEL_IDS), artistIds: ids(COVERAGE_ARTIST_IDS) };
}
