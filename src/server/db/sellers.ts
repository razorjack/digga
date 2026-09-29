import { type Db, nowIso } from "./db.ts";

/** What one read of a seller's shop found. */
export interface SellerShop {
  /** The seller's Discogs user id. */
  id: number;
  username: string;
  /** Listings the shop had for sale. */
  listings: number;
  /** Listings read; fewer than `listings` when the API stopped paging. */
  read: number;
  releaseIds: number[];
}

/** Replaces the releases known for a seller with those of a fresh read. */
export function saveSellerShop(db: Db, shop: SellerShop): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO seller_releases (seller_id, release_id) VALUES (?, ?)",
  );
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sellers (id, username, listings, listings_read, read_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET username = excluded.username, listings = excluded.listings,
         listings_read = excluded.listings_read, read_at = excluded.read_at`,
    ).run(shop.id, shop.username, shop.listings, shop.read, nowIso());
    db.prepare("DELETE FROM seller_releases WHERE seller_id = ?").run(shop.id);
    for (const releaseId of shop.releaseIds) insert.run(shop.id, releaseId);
  })();
}

/** The seller's releases that are loaded in the universe, one per triage key. */
export function countSellerRecords(db: Db, sellerId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT r.triage_key) AS n FROM seller_releases sr
       JOIN releases r ON r.id = sr.release_id AND r.in_universe = 1
       WHERE sr.seller_id = ?`,
    )
    .get(sellerId) as { n: number };
  return row.n;
}
