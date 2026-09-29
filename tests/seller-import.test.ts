import { describe, expect, it } from "vite-plus/test";
import { countSellerRecords, saveSellerShop } from "../src/server/db/sellers.ts";
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
  release: { id: releaseId },
  seller: { id: 6, username: "Shop" },
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
    rateLimit: () => ({ limit: null, remaining: null, used: null }),
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

    // A second read replaces the first.
    await importSeller(
      { db, discogs: fakeShop([[listing(1006)]]), logger: silentLogger },
      { username: "Shop" },
    );
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
    saveSellerShop(db, { id: 6, username: "Shop", listings: 1, read: 1, releaseIds: [1006] });
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
