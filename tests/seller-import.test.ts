import { describe, expect, it } from "vite-plus/test";
import {
  countSellerRecords,
  saveSellerShop,
  type SellerListing,
  shopListingsOf,
} from "../src/server/db/sellers.ts";
import { DiscogsApiError, type DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsInventoryPage, DiscogsListing } from "../src/server/discogs/types.ts";
import { importSeller, MAX_INVENTORY_PAGES } from "../src/server/importers/seller.ts";
import { queryQueue } from "../src/server/queue/query.ts";
import { searchScopes } from "../src/server/queue/scopes.ts";
import type { SellerImportProgress } from "../src/shared/types.ts";
import { filters, fixtureDb, silentLogger } from "./helpers.ts";

const listing = (releaseId: number, status = "For Sale"): DiscogsListing => ({
  id: releaseId * 10,
  status,
  condition: "Near Mint (NM or M-)",
  sleeve_condition: "Generic",
  price: { value: 3, currency: "EUR" },
  comments: " Plays great. ",
  posted: "2026-09-01T10:00:00-07:00",
  release: { id: releaseId },
  seller: { id: 6, username: "Shop" },
});

const sellerListing = (releaseId: number, price: number | null = 3): SellerListing => ({
  id: releaseId * 10,
  releaseId,
  mediaCondition: "Very Good Plus (VG+)",
  sleeveCondition: null,
  price,
  currency: "GBP",
  comments: "",
  postedAt: null,
});

/** A shop whose inventory pages are given, or generated when `pages` is a number. */
function fakeShop(pages: DiscogsListing[][] | number, requested: number[] = []) {
  const pageCount = typeof pages === "number" ? pages : pages.length;
  const unused = () => Promise.reject(new Error("unused"));
  const discogs: DiscogsClient = {
    getUser: async (username) => {
      if (username === "nobody") throw new DiscogsApiError(404, "{}");
      return { id: 6, username: "Shop", num_for_sale: pageCount };
    },
    getInventoryPage: async (_username, page): Promise<DiscogsInventoryPage> => {
      requested.push(page);
      const listings = typeof pages === "number" ? [listing(50_000 + page)] : pages[page - 1]!;
      const items = typeof pages === "number" ? pages : pages.flat().length;
      return { pagination: { page, pages: pageCount, per_page: 100, items }, listings };
    },
    getRelease: unused,
    getCollectionPage: unused,
    getWantlistPage: unused,
    getIdentity: unused,
    getMaster: unused,
    getUserLists: unused,
    getList: unused,
    addToWantlist: unused,
    removeFromWantlist: unused,
    withSignal() {
      return this;
    },
    hasToken: () => false,
  };
  return discogs;
}

describe("seller shop import", () => {
  it("keeps the releases for sale and counts those loaded, one per record", async () => {
    const db = await fixtureDb();
    const progress: SellerImportProgress[] = [];
    // 1001 and 1002 are pressings of one master; 9999 is not loaded; a sold 1006 is left out.
    const shop = fakeShop([
      [listing(1001), listing(1002)],
      [listing(9999), listing(1006, "Sold")],
    ]);
    const result = await importSeller(
      { db, discogs: shop, logger: silentLogger },
      { username: "shop" },
      (step) => progress.push(step),
    );
    expect(result).toMatchObject({
      kind: "seller",
      sellerId: 6,
      username: "Shop",
      saved: true,
      pages: 2,
      listings: 4,
      read: 4,
      records: 1,
      gone: null,
      added: null,
    });
    expect(progress.map((step) => [step.page, step.records])).toEqual([
      [1, null],
      [2, null],
      [2, 1],
    ]);
    const shopScope = { kind: "seller", id: 6 } as const;
    const items = queryQueue(db, {
      filters: filters({}),
      strategy: "label_sweep",
      limit: 10,
      scope: shopScope,
    });
    expect(items.map((item) => item.id)).toEqual([1001]);
    expect(searchScopes(db, "sho")[0]).toEqual({
      kind: "seller",
      id: 6,
      name: "Shop",
      records: 1,
    });

    // A second read replaces the first and says what changed.
    const reread = await importSeller(
      { db, discogs: fakeShop([[listing(1006)]]), logger: silentLogger },
      { username: "Shop" },
    );
    expect(reread).toMatchObject({ gone: 3, added: 1 });
    expect(shopListingsOf(db, 1001)).toEqual([]);
    expect(
      queryQueue(db, {
        filters: filters({}),
        strategy: "label_sweep",
        limit: 10,
        scope: shopScope,
      }),
    ).toEqual([expect.objectContaining({ id: 1006 })]);
    db.close();
  });

  it("keeps each copy's grading, price and comment, cheapest first", async () => {
    const db = await fixtureDb();
    await importSeller(
      { db, discogs: fakeShop([[listing(1001), listing(1006, "Sold")]]), logger: silentLogger },
      { username: "Shop" },
    );
    expect(shopListingsOf(db, 1001)).toEqual([
      {
        id: 10010,
        seller: { id: 6, username: "Shop" },
        mediaCondition: "Near Mint (NM or M-)",
        sleeveCondition: "Generic",
        price: 3,
        currency: "EUR",
        comments: "Plays great.",
        postedAt: "2026-09-01T10:00:00-07:00",
      },
    ]);
    expect(shopListingsOf(db, 1006)).toEqual([]);

    saveSellerShop(db, {
      id: 6,
      username: "Shop",
      listingCount: 3,
      read: 3,
      listings: [
        sellerListing(1001, null),
        { ...sellerListing(1001, 9), id: 7 },
        sellerListing(1002, 2),
      ],
    });
    expect(shopListingsOf(db, 1001).map((copy) => copy.price)).toEqual([9, null]);
    db.close();
  });

  it("stops at the pages Discogs serves and says how much of the shop it read", async () => {
    const db = await fixtureDb();
    const requested: number[] = [];
    const result = await importSeller(
      { db, discogs: fakeShop(150, requested), logger: silentLogger },
      { username: "Shop" },
    );
    expect(requested).toHaveLength(MAX_INVENTORY_PAGES);
    expect(result).toMatchObject({ pages: 100, listings: 150, read: 100, records: 0 });
    db.close();
  });

  it("keeps the previous read when cancelled, and names a user who does not exist", async () => {
    const db = await fixtureDb();
    saveSellerShop(db, {
      id: 6,
      username: "Shop",
      listingCount: 1,
      read: 1,
      listings: [sellerListing(1006)],
    });
    const controller = new AbortController();
    const result = await importSeller(
      { db, discogs: fakeShop([[listing(1001)], [listing(1002)]]), logger: silentLogger },
      { username: "Shop", signal: controller.signal },
      () => controller.abort(),
    );
    expect(result).toMatchObject({ saved: false, page: 1, records: null });
    expect(countSellerRecords(db, 6)).toBe(1);
    await expect(
      importSeller({ db, discogs: fakeShop([]), logger: silentLogger }, { username: "nobody" }),
    ).rejects.toThrow("Discogs has no user named nobody");
    db.close();
  });
});
