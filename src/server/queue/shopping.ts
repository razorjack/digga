import type { QueueItem, ShopListing } from "../../shared/api.ts";
import type {
  ShoppingItem,
  ShoppingResponse,
  ShoppingSeller,
  ShoppingState,
} from "../../shared/shopping.ts";
import { type Db, nowIso } from "../db/db.ts";
import type { ReleaseRow } from "../db/releases.ts";
import { shopListingsOf } from "../db/sellers.ts";
import { rowToQueueItem } from "./query.ts";

interface SavedDecision {
  listingId: number;
  state: ShoppingState;
  snapshot: string;
}

interface ShoppingSnapshot {
  listing: ShopListing;
  release: QueueItem;
}

const ACTIVE_WANT = `EXISTS (SELECT 1 FROM memberships m WHERE m.release_id = l.release_id
  AND m.kind = 'wantlist' AND m.removed_at IS NULL)`;

export function shoppingSellers(db: Db): ShoppingSeller[] {
  return db
    .prepare(`SELECT s.id, s.username, s.read_at AS readAt, s.listings,
    s.listings_read AS listingsRead,
    (SELECT COUNT(DISTINCT l.release_id) FROM seller_listings l
      WHERE l.seller_id = s.id AND ${ACTIVE_WANT}) AS wants,
    (SELECT COUNT(*) FROM shopping_decisions d
      WHERE d.seller_id = s.id AND d.state = 'shortlisted') AS shortlisted
    FROM sellers s ORDER BY s.username COLLATE NOCASE`)
    .all() as ShoppingSeller[];
}

/** Shopping matches exact wants, independently of digging filters, verdicts and master grouping. */
export function shoppingQueue(db: Db, sellerId: number): ShoppingResponse | null {
  const seller = shoppingSellers(db).find((shop) => shop.id === sellerId);
  if (!seller) return null;
  const saved = db
    .prepare(`SELECT listing_id AS listingId, state, snapshot_json AS snapshot
    FROM shopping_decisions WHERE seller_id = ?`)
    .all(sellerId) as SavedDecision[];
  const decisions = new Map(saved.map((decision) => [decision.listingId, decision]));
  const live = shoppingListings(db, seller);
  const items = live.map((snapshot) => shoppingItem(snapshot, decisions.get(snapshot.listing.id)));
  const availableIds = new Set(live.map((snapshot) => snapshot.listing.id));
  for (const decision of saved) {
    if (availableIds.has(decision.listingId) || decision.state === "pending") continue;
    const snapshot = JSON.parse(decision.snapshot) as ShoppingSnapshot;
    const item = savedShoppingItem(db, seller, snapshot, decision);
    items.push(item);
  }
  return { seller, items };
}

/** A restored selection can still be for sale before its release is loaded into the catalogue. */
function savedShoppingItem(
  db: Db,
  seller: ShoppingSeller,
  snapshot: ShoppingSnapshot,
  decision: SavedDecision,
): ShoppingItem {
  const listing = shopListingsOf(db, snapshot.release.id).find(
    (copy) => copy.id === decision.listingId && copy.seller.id === seller.id,
  );
  const item = shoppingItem({ ...snapshot, listing: listing ?? snapshot.listing }, decision);
  if (!listing)
    item.availability = seller.listingsRead < seller.listings ? "unknown" : "unavailable";
  return item;
}

/** The server captures the copy and price; clients cannot supply a different seller or release. */
export function saveShoppingDecision(
  db: Db,
  sellerId: number,
  listingId: number,
  state: ShoppingState,
): ShoppingResponse | null {
  return db.transaction(() => {
    const queue = shoppingQueue(db, sellerId);
    const item = queue?.items.find((candidate) => candidate.listing.id === listingId);
    if (!item) return null;
    const snapshot: ShoppingSnapshot = { listing: item.listing, release: item.release };
    db.prepare(`INSERT INTO shopping_decisions
      (listing_id, seller_id, state, snapshot_json, updated_at)
      VALUES (@listingId, @sellerId, @state, @snapshot, @now)
      ON CONFLICT(seller_id, listing_id) DO UPDATE SET state = excluded.state,
        snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`).run({
      listingId,
      sellerId,
      state,
      snapshot: JSON.stringify(snapshot),
      now: nowIso(),
    });
    return shoppingQueue(db, sellerId);
  })();
}

interface ListingRow extends ReleaseRow {
  video_count: number;
  listing_id: number;
  media_condition: string | null;
  sleeve_condition: string | null;
  price: number | null;
  listing_currency: string | null;
  comments: string;
  posted_at: string | null;
}

function shoppingListings(db: Db, seller: ShoppingSeller): ShoppingSnapshot[] {
  const rows = db
    .prepare(`SELECT r.*, l.id AS listing_id, l.media_condition, l.sleeve_condition,
    l.price, l.currency AS listing_currency, l.comments, l.posted_at,
    (SELECT COUNT(*) FROM videos v WHERE v.release_id = r.id) AS video_count
    FROM seller_listings l JOIN releases r ON r.id = l.release_id
    WHERE l.seller_id = ? AND (${ACTIVE_WANT} OR EXISTS
      (SELECT 1 FROM shopping_decisions d WHERE d.listing_id = l.id AND d.seller_id = l.seller_id
       AND d.state <> 'pending'))
    ORDER BY r.artist_display COLLATE NOCASE, r.title COLLATE NOCASE, r.id, l.price IS NULL, l.price, l.id`)
    .all(seller.id) as ListingRow[];
  return rows.map((row) => ({
    release: rowToQueueItem(row),
    listing: {
      id: row.listing_id,
      seller: { id: seller.id, username: seller.username },
      mediaCondition: row.media_condition,
      sleeveCondition: row.sleeve_condition,
      price: row.price,
      currency: row.listing_currency,
      comments: row.comments,
      postedAt: row.posted_at,
    },
  }));
}

function shoppingItem(snapshot: ShoppingSnapshot, decision?: SavedDecision): ShoppingItem {
  const previous = decision ? (JSON.parse(decision.snapshot) as ShoppingSnapshot) : snapshot;
  return {
    ...snapshot,
    state: decision?.state ?? "pending",
    availability: "available",
    priceChanged:
      previous.listing.price !== snapshot.listing.price ||
      previous.listing.currency !== snapshot.listing.currency,
    savedPrice: previous.listing.price,
    savedCurrency: previous.listing.currency,
  };
}
