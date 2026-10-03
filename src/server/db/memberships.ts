import { toUtcTimestamp } from "../../shared/timestamp.ts";
import type { MembershipKind, RecordMembership } from "../../shared/types.ts";
import { type Db, nowIso } from "./db.ts";

/** A release the Discogs account holds, as an import or Digga's own push found it. */
export interface MembershipWrite {
  kind: MembershipKind;
  releaseId: number;
  masterId: number | null;
  /** As Discogs sent it; null for a Maybe-list item. */
  dateAdded: string | null;
  rating: number | null;
  /** The Discogs note, or the list item's comment. */
  notes: string | null;
}

/** What the account holds of a record, and since when, for Twelves. */
export interface HeldRecord extends RecordMembership {
  /** When the newest of its items reached the account. */
  since: string;
  /** The release of that item. */
  releaseId: number;
}

/**
 * Records that the account holds the release. Returns whether it is new to Digga: the first
 * import or push that finds it, or one that finds it again after an import missed it.
 */
export function recordMembership(db: Db, item: MembershipWrite): boolean {
  const now = nowIso();
  const known = db
    .prepare("SELECT 1 FROM memberships WHERE kind = ? AND release_id = ? AND removed_at IS NULL")
    .get(item.kind, item.releaseId);
  db.prepare(
    `INSERT INTO memberships (kind, release_id, master_id, date_added, rating, notes, added_at,
       imported_at)
     VALUES (@kind, @release_id, @master_id, @date_added, @rating, @notes, @now, @now)
     ON CONFLICT(kind, release_id) DO UPDATE SET master_id = excluded.master_id,
       date_added = excluded.date_added, rating = excluded.rating, notes = excluded.notes,
       imported_at = excluded.imported_at, removed_at = NULL`,
  ).run({
    kind: item.kind,
    release_id: item.releaseId,
    master_id: item.masterId,
    date_added: item.dateAdded,
    rating: item.rating,
    notes: item.notes,
    now,
  });
  return known === undefined;
}

/** Digga took the release off the account itself, so nothing remains to remember. */
export function forgetMembership(db: Db, kind: MembershipKind, releaseId: number): void {
  db.prepare("DELETE FROM memberships WHERE kind = ? AND release_id = ?").run(kind, releaseId);
}

/** Triage keys of the records the account holds items of, with what it holds. */
export function heldRecords(db: Db): Map<string, HeldRecord> {
  const rows = db
    .prepare(
      `SELECT r.triage_key AS key, m.kind, m.release_id AS releaseId,
         COALESCE(m.date_added, m.added_at) AS since
       FROM memberships m JOIN releases r ON r.id = m.release_id
       WHERE m.removed_at IS NULL`,
    )
    .all() as HeldItem[];
  const held = new Map<string, HeldRecord>();
  for (const row of rows) {
    const record = held.get(row.key) ?? { ...NOT_HELD, since: "", releaseId: row.releaseId };
    held.set(row.key, withItem(record, row));
  }
  return held;
}

/** What the account holds of one record. */
export function recordMembershipOf(db: Db, key: string): RecordMembership {
  const kinds = db
    .prepare(
      `SELECT DISTINCT m.kind FROM memberships m JOIN releases r ON r.id = m.release_id
       WHERE r.triage_key = ? AND m.removed_at IS NULL`,
    )
    .pluck()
    .all(key) as MembershipKind[];
  return {
    owned: kinds.includes("collection"),
    onWantlist: kinds.includes("wantlist"),
    onList: kinds.includes("list"),
  };
}

/** Releases the account holds, per kind. */
export function countMemberships(db: Db): Record<MembershipKind, number> {
  const counts: Record<MembershipKind, number> = { collection: 0, wantlist: 0, list: 0 };
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n FROM memberships WHERE removed_at IS NULL GROUP BY kind")
    .all() as { kind: MembershipKind; n: number }[];
  for (const row of rows) counts[row.kind] = row.n;
  return counts;
}

export const NOT_HELD: RecordMembership = { owned: false, onWantlist: false, onList: false };

interface HeldItem {
  key: string;
  kind: MembershipKind;
  releaseId: number;
  since: string;
}

function withItem(record: HeldRecord, item: HeldItem): HeldRecord {
  const since = toUtcTimestamp(item.since);
  const newer = since > record.since;
  return {
    owned: record.owned || item.kind === "collection",
    onWantlist: record.onWantlist || item.kind === "wantlist",
    onList: record.onList || item.kind === "list",
    since: newer ? since : record.since,
    releaseId: newer ? item.releaseId : record.releaseId,
  };
}
