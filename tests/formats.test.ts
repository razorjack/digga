import { describe, expect, it } from "vite-plus/test";
import { formatSummary, isVinyl } from "../src/shared/formats.ts";

describe("formats", () => {
  const formats = [
    { name: "Vinyl", qty: 2, text: "", descriptions: ['12"', "33 ⅓ RPM"] },
    { name: "CD", qty: 1, text: "Promo", descriptions: [] },
  ];
  it("summarises formats", () => {
    expect(formatSummary(formats)).toBe('2 x Vinyl (12", 33 ⅓ RPM), CD Promo');
  });
  it("detects vinyl", () => {
    expect(isVinyl(formats)).toBe(true);
    expect(isVinyl([{ name: "CD", qty: 1, text: "", descriptions: [] }])).toBe(false);
  });
});
