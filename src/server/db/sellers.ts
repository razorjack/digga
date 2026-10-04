import type { ShopListing } from "../../shared/api.ts";
import { type Db, nowIso } from "./db.ts";

/** One copy for sale in a seller's shop, as stored for the seller. */
export interface SellerListing extends Omit<ShopListing, "seller"> {
  releaseId: number;
}

/** What one read of a seller's shop found. */
export interface SellerShop {
  /** The seller's Discogs user id. */
  id: number;
  username: string;
  /** Listings the shop had for sale. */
  listingCount: number;
  /** Listings read; fewer than `listingCount` when the API stopped paging. */
  read: number;
  listings: SellerListing[];
}

/** How the releases for sale changed since the previous read of the shop. */
export interface ShopChanges {
  /** Releases no longer for sale: sold, or taken off the shop. */
  gone: number;
  /** Releases for sale that the previous read did not find. */
  added: number;
}

/**
 * Replaces the releases and listings known for a seller with those of a fresh read. Returns how
 * the releases for sale changed, or null on the shop's first read.
 */
export function saveSellerShop(db: Db, shop: SellerShop): ShopChanges | null {
  const releaseIds = new Set(shop.listings.map((listing) => listing.releaseId));
  return db.transaction(() => {
    const changes = compareWithPreviousRead(db, shop.id, releaseIds);
    db.prepare(
      `INSERT INTO sellers (id, username, listings, listings_read, read_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET username = excluded.username, listings = excluded.listings,
         listings_read = excluded.listings_read, read_at = excluded.read_at`,
    ).run(shop.id, shop.username, shop.listingCount, shop.read, nowIso());
    replaceSellerReleases(db, shop.id, releaseIds);
    replaceSellerListings(db, shop.id, shop.listings);
    return changes;
  })();
}

function compareWithPreviousRead(
  db: Db,
  sellerId: number,
  releaseIds: Set<number>,
): ShopChanges | null {
  const read = db.prepare("SELECT 1 FROM sellers WHERE id = ?").get(sellerId);
  if (!read) return null;
  const previous = db
    .prepare("SELECT release_id FROM seller_releases WHERE seller_id = ?")
    .pluck()
    .all(sellerId) as number[];
  const previousIds = new Set(previous);
  return {
    gone: previous.filter((id) => !releaseIds.has(id)).length,
    added: [...releaseIds].filter((id) => !previousIds.has(id)).length,
  };
}

function replaceSellerReleases(db: Db, sellerId: number, releaseIds: Set<number>): void {
  db.prepare("DELETE FROM seller_releases WHERE seller_id = ?").run(sellerId);
  const insert = db.prepare("INSERT INTO seller_releases (seller_id, release_id) VALUES (?, ?)");
  for (const releaseId of releaseIds) insert.run(sellerId, releaseId);
}

function replaceSellerListings(db: Db, sellerId: number, listings: SellerListing[]): void {
  db.prepare("DELETE FROM seller_listings WHERE seller_id = ?").run(sellerId);
  // A listing that moved to another seller's account keeps its id.
  const insert = db.prepare(
    `INSERT OR REPLACE INTO seller_listings (id, seller_id, release_id, media_condition,
       sleeve_condition, price, currency, comments, posted_at)
     VALUES (@id, @seller_id, @release_id, @media_condition, @sleeve_condition, @price, @currency,
       @comments, @posted_at)`,
  );
  for (const listing of listings) {
    insert.run({
      id: listing.id,
      seller_id: sellerId,
      release_id: listing.releaseId,
      media_condition: listing.mediaCondition,
      sleeve_condition: listing.sleeveCondition,
      price: listing.price,
      currency: listing.currency,
      comments: listing.comments,
      posted_at: listing.postedAt,
    });
  }
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

interface ShopListingRow {
  id: number;
  seller_id: number;
  username: string;
  media_condition: string | null;
  sleeve_condition: string | null;
  price: number | null;
  currency: string | null;
  comments: string;
  posted_at: string | null;
}

/** The copies of a release for sale in the shops Digga has read, cheapest first. */
export function shopListingsOf(db: Db, releaseId: number): ShopListing[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.seller_id, s.username, l.media_condition, l.sleeve_condition, l.price,
         l.currency, l.comments, l.posted_at
       FROM seller_listings l JOIN sellers s ON s.id = l.seller_id
       WHERE l.release_id = ?
       ORDER BY l.price IS NULL, l.price, l.id`,
    )
    .all(releaseId) as ShopListingRow[];
  return rows.map((row) => ({
    id: row.id,
    seller: { id: row.seller_id, username: row.username },
    mediaCondition: row.media_condition,
    sleeveCondition: row.sleeve_condition,
    price: row.price,
    currency: row.currency,
    comments: row.comments,
    postedAt: row.posted_at,
  }));
}
