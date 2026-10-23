import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createHttpApi } from "../src/client/api.ts";
import { ShoppingSession } from "../src/client/shopping/session.svelte.ts";
import type { Db } from "../src/server/db/db.ts";
import { recordMembership } from "../src/server/db/memberships.ts";
import { saveSellerShop } from "../src/server/db/sellers.ts";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import { saveShoppingDecision, shoppingQueue } from "../src/server/queue/shopping.ts";
import type { ReleaseDetail } from "../src/shared/api.ts";
import type { ShoppingResponse, ShoppingState } from "../src/shared/shopping.ts";
import { fixtureDb } from "./helpers.ts";

let db: Db;
let session: ShoppingSession;
beforeEach(async () => {
  db = await fixtureDb();
  recordMembership(db, {
    kind: "wantlist",
    releaseId: 1001,
    masterId: 501,
    rating: null,
    dateAdded: null,
    notes: null,
  });
  saveSellerShop(db, {
    id: 6,
    username: "Shop",
    listingCount: 2,
    read: 2,
    listings: [1, 2].map((id) => ({
      id,
      releaseId: 1001,
      price: id * 3,
      currency: "EUR",
      mediaCondition: null,
      sleeveCondition: null,
      comments: "",
      postedAt: null,
    })),
  });
});
afterEach(() => {
  session?.destroy();
  db.close();
});

function client() {
  return {
    ...createHttpApi(),
    getShopping: vi.fn(async () => shoppingQueue(db, 6)!),
    getRelease: vi.fn(async () => buildReleaseDetail(db, 1001)!),
    putShoppingDecision: vi.fn(async (sellerId: number, listingId: number, state: ShoppingState) =>
      saveShoppingDecision(db, sellerId, listingId, state)!,
    ),
  };
}

describe("shopping session", () => {
  it("keeps the current copy after a failed write and retries before advancing", async () => {
    const api = client();
    api.putShoppingDecision.mockRejectedValueOnce(new Error("offline"));
    session = new ShoppingSession(api);
    await session.open(6);
    await session.decide("shortlisted");
    expect(session.current?.listing.id).toBe(1);
    expect(session.error).toContain("Not saved: offline");
    expect(session.history).toHaveLength(0);
    await session.decide("shortlisted");
    expect(session.current?.listing.id).toBe(2);
    await session.undo();
    expect(session.current?.listing.id).toBe(1);
    expect(session.current?.state).toBe("pending");
  });

  it("ignores repeated decisions and selection changes while a write is pending", async () => {
    const api = client();
    const pending = Promise.withResolvers<ShoppingResponse>();
    api.putShoppingDecision.mockReturnValueOnce(pending.promise);
    session = new ShoppingSession(api);
    await session.open(6);
    const saving = session.decide("shortlisted");
    await session.decide("skipped");
    session.switchView("shortlisted");
    session.select(2);
    expect(session.view).toBe("pending");
    expect(session.current?.listing.id).toBe(1);
    pending.resolve(saveShoppingDecision(db, 6, 1, "shortlisted")!);
    await saving;
    expect(api.putShoppingDecision).toHaveBeenCalledTimes(1);
    expect(session.current?.listing.id).toBe(2);
  });

  it("keeps reviewed copies on the shortlist, completes a pass and undoes a removal", async () => {
    session = new ShoppingSession(client());
    await session.open(6);
    await session.decide("shortlisted");
    await session.decide("shortlisted");
    session.switchView("shortlisted");
    await session.decide("shortlisted");
    expect(session.items).toHaveLength(2);
    expect(session.current?.listing.id).toBe(2);
    await session.decide("skipped");
    expect(session.current).toBeNull();
    await session.undo();
    expect(session.current?.listing.id).toBe(2);
    expect(session.items).toHaveLength(2);
  });

  it("rejects stale queue and release completions after another selection or destruction", async () => {
    const api = client();
    const first = Promise.withResolvers<ShoppingResponse>();
    const details = Promise.withResolvers<ReleaseDetail>();
    api.getShopping.mockReturnValueOnce(first.promise);
    api.getRelease.mockReturnValueOnce(details.promise);
    session = new ShoppingSession(api);
    const old = session.open(7);
    await session.open(6);
    first.resolve({ ...shoppingQueue(db, 6)!, seller: { ...shoppingQueue(db, 6)!.seller, id: 7 } });
    await old;
    expect(session.shop?.seller.id).toBe(6);
    session.destroy();
    details.resolve(buildReleaseDetail(db, 1001)!);
    await details.promise;
    expect(session.detail).toBeNull();
  });
});
