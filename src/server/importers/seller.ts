import type { SellerImportProgress } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { countSellerRecords, type SellerListing, saveSellerShop } from "../db/sellers.ts";
import { type DiscogsClient, DiscogsApiError } from "../discogs/client.ts";
import type { DiscogsListing, DiscogsUser } from "../discogs/types.ts";
import type { Logger } from "../logger.ts";

export interface SellerImportDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

export interface SellerImportOptions {
  username: string;
  signal?: AbortSignal;
}

export interface SellerImportResult extends SellerImportProgress {
  kind: "seller";
  sellerId: number;
  /** False when the read was cancelled and the previous one kept. */
  saved: boolean;
}

/** Discogs serves at most 100 pages of someone else's inventory: 10,000 listings. */
export const MAX_INVENTORY_PAGES = 100;
const PER_PAGE = 100;

/**
 * Reads the copies a seller has for sale and keeps them, with their grading and price, for the
 * seller scope. A new read replaces the previous one, so sold copies drop out. A cancelled read
 * keeps the previous one, since half a shop would look like a whole one.
 */
export async function importSeller(
  deps: SellerImportDeps,
  options: SellerImportOptions,
  onProgress?: (progress: SellerImportProgress) => void,
): Promise<SellerImportResult> {
  const reading = { ...deps, discogs: deps.discogs.withSignal(options.signal) };
  const seller = await findSeller(reading.discogs, options.username);
  const inventory = await readInventory(reading, seller.username, options, onProgress);
  if (options.signal?.aborted)
    return { kind: "seller", sellerId: seller.id, saved: false, ...inventory.progress };

  const changes = saveSellerShop(deps.db, {
    id: seller.id,
    username: seller.username,
    listingCount: inventory.progress.listings ?? 0,
    read: inventory.progress.read,
    listings: inventory.listings,
  });
  const progress: SellerImportProgress = {
    ...inventory.progress,
    records: countSellerRecords(deps.db, seller.id),
    gone: changes?.gone ?? null,
    added: changes?.added ?? null,
  };
  onProgress?.({ ...progress });

  deps.logger.info(
    `seller ${seller.username}: ${progress.read} of ${progress.listings} listings read, ${progress.records} loaded records`,
  );
  return { kind: "seller", sellerId: seller.id, saved: true, ...progress };
}

async function findSeller(discogs: DiscogsClient, username: string): Promise<DiscogsUser> {
  try {
    return await discogs.getUser(username);
  } catch (error) {
    if (error instanceof DiscogsApiError && error.status === 404)
      throw new Error(`Discogs has no user named ${username}`);
    throw error;
  }
}

async function readInventory(
  deps: SellerImportDeps,
  username: string,
  options: SellerImportOptions,
  onProgress?: (progress: SellerImportProgress) => void,
): Promise<{ progress: SellerImportProgress; listings: SellerListing[] }> {
  const progress: SellerImportProgress = {
    username,
    page: 0,
    pages: null,
    listings: null,
    read: 0,
    records: null,
    gone: null,
    added: null,
  };
  const listings: SellerListing[] = [];
  let page = 1;
  for (;;) {
    if (options.signal?.aborted) break;
    const data = await deps.discogs.getInventoryPage(username, page, PER_PAGE);
    // The seller's own token also shows drafts and sold items.
    const forSale = data.listings.filter(
      (listing) => (listing.status ?? "For Sale") === "For Sale",
    );
    listings.push(...forSale.map(toSellerListing));
    progress.page = page;
    progress.pages = Math.min(data.pagination.pages, MAX_INVENTORY_PAGES);
    progress.listings = data.pagination.items;
    progress.read += data.listings.length;
    onProgress?.({ ...progress });
    if (page >= progress.pages || data.listings.length === 0) break;
    page += 1;
  }
  return { progress, listings };
}

function toSellerListing(listing: DiscogsListing): SellerListing {
  return {
    id: listing.id,
    releaseId: listing.release.id,
    mediaCondition: listing.condition ?? null,
    sleeveCondition: listing.sleeve_condition ?? null,
    price: listing.price?.value ?? null,
    currency: listing.price?.currency ?? null,
    comments: listing.comments?.trim() ?? "",
    postedAt: listing.posted ?? null,
  };
}
