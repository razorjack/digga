import { describe, expect, it } from "vite-plus/test";
import type { ReleaseDetail, ShopListing } from "../src/shared/api.ts";
import { listingGrade, sellerCopies } from "../src/shared/listings.ts";

const copy = (overrides: Partial<ShopListing> = {}): ShopListing => ({
  id: 1,
  seller: { id: 6, username: "Shop" },
  mediaCondition: "Near Mint (NM or M-)",
  sleeveCondition: "Very Good Plus (VG+)",
  price: 3,
  currency: "EUR",
  comments: "",
  postedAt: null,
  ...overrides,
});

describe("shop listings", () => {
  it("grades a copy as Discogs abbreviates it, record first", () => {
    expect(listingGrade(copy())).toEqual({
      text: "NM / VG+",
      spoken: "record Near Mint (NM or M-), sleeve Very Good Plus (VG+)",
      tone: "top",
    });
    expect(listingGrade(copy({ mediaCondition: "Mint (M)", sleeveCondition: "Generic" }))).toEqual({
      text: "M / Generic",
      spoken: "record Mint (M), sleeve Generic",
      tone: "top",
    });
    expect(listingGrade(copy({ mediaCondition: "Very Good Plus (VG+)" })).tone).toBe("fair");
    expect(listingGrade(copy({ mediaCondition: "Good Plus (G+)" })).tone).toBe("worn");
    expect(listingGrade(copy({ mediaCondition: null, sleeveCondition: null }))).toEqual({
      text: "ungraded",
      spoken: "record ungraded",
      tone: null,
    });
  });

  it("shows the scoped seller's copies only, and nothing outside a seller scope", () => {
    const other = copy({ id: 2, seller: { id: 7, username: "Other" } });
    const detail = { listings: [copy(), other] } as ReleaseDetail;
    const shop = { kind: "seller", id: 6, name: "Shop" } as const;
    expect(sellerCopies(shop, detail)).toEqual({ username: "Shop", listings: [copy()] });
    expect(sellerCopies({ kind: "label", id: 6, name: "Label" }, detail)).toBeNull();
    expect(sellerCopies(null, detail)).toBeNull();
    expect(sellerCopies(shop, null)).toBeNull();
  });
});
