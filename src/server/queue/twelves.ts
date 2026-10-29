import { TWELVES_STATUSES, type QueueItem, type TwelvesItem } from "../../shared/api.ts";
import type { Filters } from "../../shared/config.ts";
import type { RecordMembership, Verdict, VerdictStatus } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { type HeldRecord, heldRecords, NOT_HELD } from "../db/memberships.ts";
import { notesForReleases } from "../db/notes.ts";
import { listVerdicts } from "../db/verdicts.ts";
import { buildFilterWhere, queueItems, representativesForKeys } from "./query.ts";

interface ShelfRecord {
  key: string;
  verdict: Verdict | null;
  held: HeldRecord | null;
}

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
  const records = shelfRecords(db, statuses);
  const releases = shelfReleases(db, records);
  const notes = notesForReleases(db, [...releases.values()]);
  const passes = filterTest(db, filters);
  const items: TwelvesItem[] = [];
  for (const { key, verdict, held } of records) {
    const release = releases.get(key) ?? null;
    if (!passes(release?.id ?? null)) continue;
    const savedNotes = release ? notes.get(release.id) : undefined;
    items.push({
      key,
      verdict,
      release,
      membership: held ? membershipOf(held) : NOT_HELD,
      since: verdict?.decidedAt ?? held?.since ?? "",
      ...(savedNotes ?? { note: null, pressingNotes: [] }),
    });
  }
  return items.toSorted((left, right) => right.since.localeCompare(left.since));
}

function shelfRecords(db: Db, statuses: VerdictStatus[] | null): ShelfRecord[] {
  const held = heldRecords(db);
  const records: ShelfRecord[] = [];
  for (const verdict of listVerdicts(db, statuses ?? TWELVES_STATUSES)) {
    records.push({ key: verdict.key, verdict, held: held.get(verdict.key) ?? null });
    held.delete(verdict.key);
  }
  if (statuses === null)
    for (const [key, record] of held)
      if (record.owned || record.onWantlist || record.onList)
        records.push({ key, verdict: null, held: record });
  return records;
}

function shelfReleases(db: Db, records: ShelfRecord[]): Map<string, QueueItem> {
  const ids = records.map(savedReleaseId).filter((id) => id !== null);
  const byId = new Map(queueItems(db, ids).map((release) => [release.id, release]));
  const releases = new Map<string, QueueItem>();
  const missing: string[] = [];
  for (const record of records) {
    const id = savedReleaseId(record);
    const release = id === null ? undefined : byId.get(id);
    if (release) releases.set(record.key, release);
    else missing.push(record.key);
  }
  for (const [key, release] of representativesForKeys(db, missing)) releases.set(key, release);
  return releases;
}

const savedReleaseId = (record: ShelfRecord) =>
  record.verdict?.releaseId ?? record.held?.releaseId ?? null;

function membershipOf(held: HeldRecord): RecordMembership {
  const { owned, onWantlist, wantlistReleaseIds, onList, wantRemoved } = held;
  return { owned, onWantlist, wantlistReleaseIds, onList, wantRemoved };
}

/** Whether a release passes the filters; every record passes without filters. */
function filterTest(db: Db, filters: Filters | null): (releaseId: number | null) => boolean {
  if (filters === null) return () => true;
  const where = buildFilterWhere(filters, { includeDecided: true });
  const statement = db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`);
  return (releaseId) =>
    releaseId !== null && statement.get(releaseId, ...where.params) !== undefined;
}
