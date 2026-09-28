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
