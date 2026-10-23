import { ShoppingSnapshotSchema, type ShoppingRow } from "../../shared/shopping-backup.ts";
import type { Db } from "./db.ts";

export function readShoppingDecisions(db: Db): ShoppingRow[] {
  return db
    .prepare(`SELECT listing_id AS listingId, seller_id AS sellerId, state,
    snapshot_json AS snapshot, updated_at AS updatedAt FROM shopping_decisions
    ORDER BY seller_id, listing_id`)
    .all() as ShoppingRow[];
}

/** Restored shops start unread, so a saved copy is never presented as confirmed inventory. */
export function restoreShoppingDecisions(db: Db, rows: ShoppingRow[]): void {
  const seller = db.prepare(`INSERT INTO sellers (id, username, listings, listings_read, read_at)
    VALUES (?, ?, 1, 0, ?) ON CONFLICT(id) DO NOTHING`);
  const save = db.prepare(`INSERT INTO shopping_decisions
    (listing_id, seller_id, state, snapshot_json, updated_at)
    VALUES (@listingId, @sellerId, @state, @snapshot, @updatedAt)
    ON CONFLICT(seller_id, listing_id) DO UPDATE SET seller_id = excluded.seller_id, state = excluded.state,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
    WHERE excluded.updated_at > shopping_decisions.updated_at`);
  for (const row of rows) {
    const snapshot = ShoppingSnapshotSchema.parse(JSON.parse(row.snapshot));
    seller.run(row.sellerId, snapshot.listing.seller.username, row.updatedAt);
    save.run(row);
  }
}
