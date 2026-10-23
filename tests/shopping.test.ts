import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { recordMembership } from "../src/server/db/memberships.ts";
import { saveSellerShop, type SellerListing } from "../src/server/db/sellers.ts";
import { readBackedUpData, restoreBackedUpData } from "../src/server/db/user-data.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { formatDecisionsBackup, parseDecisionsBackup } from "../src/server/decisions-backup.ts";
import {
  shoppingQueue,
  shoppingSellers,
  saveShoppingDecision,
} from "../src/server/queue/shopping.ts";
import { shortlistTotals } from "../src/shared/shopping.ts";
import { fixtureDb } from "./helpers.ts";

let db: Db;
beforeEach(async () => {
  db = await fixtureDb();
});
afterEach(() => db.close());

function copy(id: number, releaseId: number, price = 3): SellerListing {
  return {
    id,
    releaseId,
    price,
    currency: "EUR",
    mediaCondition: "Very Good Plus (VG+)",
    sleeveCondition: "Generic",
    comments: "Clean copy",
    postedAt: null,
  };
}

function shop(listings: SellerListing[], total = listings.length): void {
  saveSellerShop(db, {
    id: 6,
    username: "Shop",
    listingCount: total,
    read: listings.length,
    listings,
  });
}

function want(releaseId: number): void {
  recordMembership(db, {
    kind: "wantlist",
    releaseId,
    masterId: null,
    dateAdded: null,
    rating: null,
    notes: null,
  });
}

describe("shopping queue", () => {
  it("matches exact current wants, including decided releases outside the digging universe", () => {
    want(1001);
    want(1006);
    want(1003);
    db.prepare("UPDATE memberships SET removed_at = '2026-01-01' WHERE release_id = 1003").run();
    db.prepare("UPDATE releases SET in_universe = 0 WHERE id = 1006").run();
    upsertVerdict(db, { key: "m:501", releaseId: 1001, status: "accepted", source: "manual" });
    shop([copy(1, 1001), copy(2, 1001, 20), copy(3, 1002), copy(4, 1006), copy(5, 1003)]);
    expect(
      shoppingQueue(db, 6)
        ?.items.map((item) => item.listing.id)
        .sort(),
    ).toEqual([1, 2, 4]);
    expect(shoppingSellers(db)[0]).toMatchObject({ wants: 2, shortlisted: 0 });
  });

  it("keeps shopping decisions separate from wants, verdicts and other copies", () => {
    want(1001);
    shop([copy(1, 1001), copy(2, 1001, 20)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    const result = saveShoppingDecision(db, 6, 2, "skipped")!;
    expect(result.items.map((item) => item.state)).toEqual(["shortlisted", "skipped"]);
    expect(db.prepare("SELECT COUNT(*) FROM verdicts").pluck().get()).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) FROM memberships WHERE removed_at IS NULL").pluck().get(),
    ).toBe(1);
    expect(saveShoppingDecision(db, 7, 1, "skipped")).toBeNull();
    expect(saveShoppingDecision(db, 6, 999, "shortlisted")).toBeNull();
    expect(saveShoppingDecision(db, 6, 1, "pending")?.items[0]?.state).toBe("pending");
  });

  it("keeps sold selections, flags price changes, and recognizes a returning copy", () => {
    want(1001);
    shop([copy(1, 1001), copy(2, 1001, 20)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    saveShoppingDecision(db, 6, 2, "shortlisted");
    shop([copy(1, 1001, 4)]);
    const result = shoppingQueue(db, 6)!;
    expect(result.items[0]).toMatchObject({
      priceChanged: true,
      savedPrice: 3,
      listing: { price: 4 },
    });
    expect(result.items[1]).toMatchObject({ availability: "unavailable", state: "shortlisted" });
    expect(shortlistTotals(result.items)).toEqual([{ currency: "EUR", amount: 4 }]);
    shop([copy(1, 1001, 4), copy(2, 1001, 20)]);
    expect(shoppingQueue(db, 6)?.items[1]?.availability).toBe("available");
  });

  it("does not call missing copies sold when the inventory read is incomplete", () => {
    want(1001);
    shop([copy(1, 1001)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    shop([], 20000);
    expect(shoppingQueue(db, 6)?.items[0]?.availability).toBe("unknown");
  });

  it("uses refreshed inventory for a saved copy even when its release is not loaded", () => {
    want(1001);
    shop([copy(1, 1001)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    db.prepare("DELETE FROM releases WHERE id = 1001").run();
    shop([copy(1, 1001, 4)]);
    expect(shoppingQueue(db, 6)?.items[0]).toMatchObject({
      availability: "available",
      priceChanged: true,
      listing: { price: 4 },
    });
  });

  it("keeps selections when the wantlist changes and includes new wants on the next query", () => {
    want(1001);
    shop([copy(1, 1001), copy(2, 1002)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    db.prepare("DELETE FROM memberships").run();
    want(1002);
    expect(shoppingQueue(db, 6)?.items.map((item) => item.listing.id)).toEqual([1, 2]);
  });

  it("totals currencies separately and excludes missing prices", () => {
    want(1001);
    shop([
      copy(1, 1001, 2.99),
      { ...copy(2, 1001, 20), currency: "GBP" },
      { ...copy(3, 1001), price: null },
      copy(4, 1001, 0.01),
    ]);
    for (const id of [1, 2, 3, 4]) saveShoppingDecision(db, 6, id, "shortlisted");
    expect(shortlistTotals(shoppingQueue(db, 6)!.items)).toEqual([
      { currency: "EUR", amount: 3 },
      { currency: "GBP", amount: 20 },
    ]);
  });

  it("round-trips decisions through the portable backup without claiming inventory is fresh", async () => {
    want(1001);
    shop([copy(1, 1001)]);
    saveShoppingDecision(db, 6, 1, "shortlisted");
    const backup = {
      ...readBackedUpData(db),
      app: "digga",
      kind: "decisions",
      version: 3,
      backedUpAt: new Date().toISOString(),
      config: null,
    } as const;
    const restored = parseDecisionsBackup(formatDecisionsBackup(backup), "test");
    const target = await fixtureDb();
    try {
      restoreBackedUpData(target, restored, restored.backedUpAt);
      expect(shoppingQueue(target, 6)?.items[0]).toMatchObject({
        state: "shortlisted",
        availability: "unknown",
      });
      saveSellerShop(target, {
        id: 6,
        username: "Shop",
        listingCount: 1,
        read: 1,
        listings: [copy(1, 1001)],
      });
      saveShoppingDecision(target, 6, 1, "skipped");
      target.prepare("UPDATE shopping_decisions SET updated_at = '2099-01-01T00:00:00.000Z'").run();
      restoreBackedUpData(target, restored, restored.backedUpAt);
      expect(shoppingQueue(target, 6)?.items[0]?.state).toBe("skipped");
    } finally {
      target.close();
    }
  });
});
