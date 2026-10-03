import type { QueueItem } from "../../src/shared/api.ts";
export function queueItem(id: number): QueueItem {
  return {
    id,
    triageKey: `r:${id}`,
    masterId: null,
    title: `Title ${id}`,
    artistDisplay: `Artist ${id}`,
    labelId: null,
    labelName: null,
    catno: null,
    year: 2000,
    country: null,
    formatSummary: "Vinyl",
    styles: [],
    videoCount: 0,
    communityWant: null,
    communityHave: null,
    numForSale: null,
    lowestPrice: null,
    currency: null,
    enrichedAt: null,
  };
}
