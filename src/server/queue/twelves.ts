import type { TwelvesItem } from "../../shared/api.ts";
import type { Filters } from "../../shared/config.ts";
import type { VerdictStatus } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { listVerdicts } from "../db/verdicts.ts";
import { wantlistKeys } from "../importers/seeds.ts";
import { buildFilterWhere, queueItemForRelease, representativeForKey } from "./query.ts";

export function queryTwelves(
  db: Db,
  statuses: VerdictStatus[],
  filters: Filters | null,
): TwelvesItem[] {
  const where = filters ? buildFilterWhere(filters, { includeDecided: true }) : null;
  const passes = where
    ? db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`)
    : null;
  const onWantlist = wantlistKeys(db);
  const items: TwelvesItem[] = [];
  for (const verdict of listVerdicts(db, statuses)) {
    const release =
      (verdict.releaseId !== null ? queueItemForRelease(db, verdict.releaseId) : null) ??
      representativeForKey(db, verdict.key);
    if (
      where &&
      passes &&
      (release === null || passes.get(release.id, ...where.params) === undefined)
    )
      continue;
    items.push({ verdict, release, onWantlist: onWantlist.has(verdict.key) });
  }
  return items;
}

/**
 * Release ids of the records with these verdicts, for refreshing their market data: records never
 * enriched first, then the oldest data. A verdict shows the release it was made on, else the
 * record's main release.
 */
export function releaseIdsToRefresh(db: Db, statuses: VerdictStatus[], limit: number): number[] {
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT r.id, r.enriched_at FROM verdicts v
       JOIN releases r ON r.id = COALESCE(v.release_id, (
         SELECT k.id FROM releases k WHERE k.triage_key = v.key
         ORDER BY k.is_main_release DESC, k.id LIMIT 1))
       WHERE v.status IN (${placeholders})
       ORDER BY r.enriched_at IS NOT NULL, r.enriched_at, r.id
       LIMIT ?`,
    )
    .all(...statuses, limit) as { id: number }[];
  return rows.map((row) => row.id);
}
