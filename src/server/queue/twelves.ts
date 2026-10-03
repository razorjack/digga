import { TWELVES_STATUSES, type TwelvesItem } from "../../shared/api.ts";
import type { Filters } from "../../shared/config.ts";
import type { Verdict, VerdictStatus } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { type HeldRecord, heldRecords, NOT_HELD } from "../db/memberships.ts";
import { pressingNotes, releaseNote } from "../db/notes.ts";
import { listVerdicts } from "../db/verdicts.ts";
import { buildFilterWhere, queueItemForRelease, representativeForKey } from "./query.ts";

/**
 * The records on the Twelves shelves, newest first: those decided in Digga with one of the
 * statuses, and, without statuses, also those only the Discogs account holds. With filters, only
 * records whose shown release passes them.
 */
export function queryTwelves(
  db: Db,
  statuses: VerdictStatus[] | null,
  filters: Filters | null,
): TwelvesItem[] {
  const held = heldRecords(db);
  const items: TwelvesItem[] = [];
  for (const verdict of listVerdicts(db, statuses ?? TWELVES_STATUSES)) {
    items.push(twelvesItem(db, verdict.key, { verdict, held: held.get(verdict.key) ?? null }));
    held.delete(verdict.key);
  }
  if (statuses === null)
    for (const [key, record] of held)
      items.push(twelvesItem(db, key, { verdict: null, held: record }));

  const passes = filterTest(db, filters);
  return items
    .filter((item) => passes(item.release?.id ?? null))
    .toSorted((left, right) => right.since.localeCompare(left.since));
}

function twelvesItem(
  db: Db,
  key: string,
  record: { verdict: Verdict | null; held: HeldRecord | null },
): TwelvesItem {
  const { verdict, held } = record;
  const releaseId = verdict?.releaseId ?? held?.releaseId ?? null;
  const release =
    (releaseId === null ? null : queueItemForRelease(db, releaseId)) ??
    representativeForKey(db, key);
  return {
    key,
    verdict,
    release,
    membership: held
      ? { owned: held.owned, onWantlist: held.onWantlist, onList: held.onList }
      : NOT_HELD,
    since: verdict?.decidedAt ?? held?.since ?? "",
    note: release ? (releaseNote(db, release.id) ?? null) : null,
    pressingNotes: release ? pressingNotes(db, release) : [],
  };
}

/** Whether a release passes the filters; every record passes without filters. */
function filterTest(db: Db, filters: Filters | null): (releaseId: number | null) => boolean {
  if (filters === null) return () => true;
  const where = buildFilterWhere(filters, { includeDecided: true });
  const statement = db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`);
  return (releaseId) =>
    releaseId !== null && statement.get(releaseId, ...where.params) !== undefined;
}
