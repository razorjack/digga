import { toUtcTimestamp } from "../../shared/timestamp.ts";
import type { MembershipKind, RecordMembership } from "../../shared/types.ts";
import { type Db, getMeta, nowIso, setMeta } from "./db.ts";

const ACCOUNT_KEY = "discogs_account";

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

/**
 * The records the account holds items of, by triage key, with what it holds; also those it held a
 * want of until an import found it gone, which Twelves no longer shows as wants.
 */
export function heldRecords(db: Db): Map<string, HeldRecord> {
  const rows = db
    .prepare(
      `SELECT r.triage_key AS key, m.kind, m.release_id AS releaseId,
         COALESCE(m.date_added, m.added_at) AS since, m.removed_at IS NOT NULL AS removed
       FROM memberships m JOIN releases r ON r.id = m.release_id`,
    )
    .all() as HeldItem[];
  const held = new Map<string, HeldRecord>();
  for (const [key, items] of Map.groupBy(rows, (row) => row.key))
    held.set(key, { ...membershipOf(items), ...newestItem(items) });
  return held;
}

/** What the account holds of one record. */
export function recordMembershipOf(db: Db, key: string): RecordMembership {
  const items = db
    .prepare(
      `SELECT m.kind, m.removed_at IS NOT NULL AS removed
       FROM memberships m JOIN releases r ON r.id = m.release_id WHERE r.triage_key = ?`,
    )
    .all(key) as Pick<HeldItem, "kind" | "removed">[];
  return membershipOf(items);
}

/**
 * Marks the items of a kind that a complete import did not find, because they left the account
 * outside Digga. A push Digga made while the import ran is newer than its start and stays.
 * Returns how many.
 */
export function markMissingMemberships(
  db: Db,
  kind: MembershipKind,
  found: { releaseIds: number[]; since: string },
): number {
  return db
    .prepare(
      `UPDATE memberships SET removed_at = @now
       WHERE kind = @kind AND removed_at IS NULL AND imported_at <= @since
         AND release_id NOT IN (SELECT value FROM json_each(@found))`,
    )
    .run({
      now: nowIso(),
      kind,
      since: found.since,
      found: JSON.stringify(found.releaseIds),
    }).changes;
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

/**
 * The Discogs account whose collection, wantlist and lists the library holds; null when it holds
 * none. A library from before Digga recorded the account holds the configured one's.
 */
export function heldAccount(db: Db, configured: string): string | null {
  const holds = db.prepare("SELECT 1 FROM memberships LIMIT 1").get() !== undefined;
  if (!holds) return null;
  return getMeta(db, ACCOUNT_KEY) ?? (configured === "" ? null : configured);
}

/** Why the library refuses the account: it holds another account's data. Null when it does not. */
export function accountConflict(db: Db, requested: string, configured: string): string | null {
  const held = heldAccount(db, configured);
  if (held === null || requested === "" || sameAccount(held, requested)) return null;
  return `This library holds the Discogs collection and wantlist of ${held}; forget them in Settings before using ${requested}`;
}

/**
 * Records that the library's Discogs data comes from the account. While it holds another account's,
 * records nothing and returns why it refuses this one.
 */
export function claimAccount(db: Db, username: string): string | null {
  const conflict = accountConflict(db, username, username);
  if (conflict === null) setMeta(db, ACCOUNT_KEY, username);
  return conflict;
}

/** Forgets what the account holds, so another account can be used; returns how many items. */
export function forgetAccountData(db: Db): number {
  return db.transaction(() => {
    db.prepare("DELETE FROM meta WHERE key = ?").run(ACCOUNT_KEY);
    return db.prepare("DELETE FROM memberships").run().changes;
  })();
}

export const NOT_HELD: RecordMembership = {
  owned: false,
  onWantlist: false,
  onList: false,
  wantRemoved: false,
};

interface HeldItem {
  key: string;
  kind: MembershipKind;
  releaseId: number;
  since: string;
  /** SQLite's boolean: 1 when an import found the item gone. */
  removed: number;
}

function membershipOf(items: Pick<HeldItem, "kind" | "removed">[]): RecordMembership {
  const holds = (kind: MembershipKind) => items.some((item) => item.kind === kind && !item.removed);
  const onWantlist = holds("wantlist");
  const lostWant = items.some((item) => item.kind === "wantlist" && item.removed);
  return {
    owned: holds("collection"),
    onWantlist,
    onList: holds("list"),
    wantRemoved: lostWant && !onWantlist,
  };
}

/** The newest item the account still holds; Twelves dates and shows the record by it. */
function newestItem(items: HeldItem[]): { since: string; releaseId: number } {
  const held = items.filter((item) => !item.removed);
  return (held.length > 0 ? held : items)
    .map((item) => ({ since: toUtcTimestamp(item.since), releaseId: item.releaseId }))
    .reduce((left, right) => (right.since > left.since ? right : left));
}

/** Discogs usernames ignore case. */
function sameAccount(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
