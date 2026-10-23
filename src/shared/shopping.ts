import { z } from "zod";
import type { QueueItem, ShopListing } from "./api.ts";

export const ShoppingStateSchema = z.enum(["pending", "shortlisted", "skipped"]);
export type ShoppingState = z.infer<typeof ShoppingStateSchema>;
export const ShoppingDecisionSchema = z.object({ state: ShoppingStateSchema });

export interface ShoppingSeller {
  id: number;
  username: string;
  readAt: string;
  listings: number;
  listingsRead: number;
  wants: number;
  shortlisted: number;
}

export interface ShoppingItem {
  listing: ShopListing;
  release: QueueItem;
  state: ShoppingState;
  availability: "available" | "unavailable" | "unknown";
  priceChanged: boolean;
  savedPrice: number | null;
  savedCurrency: string | null;
}

export interface ShoppingResponse {
  seller: ShoppingSeller;
  items: ShoppingItem[];
}

/** Prices stay in their original currencies; missing or unavailable prices are not a subtotal. */
export function shortlistTotals(items: ShoppingItem[]): {
  currency: string;
  amount: number;
}[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const { price, currency } = item.listing;
    if (item.state !== "shortlisted" || item.availability !== "available") continue;
    if (price === null || currency === null) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + Math.round(price * 100));
  }
  return [...totals].map(([currency, cents]) => ({ currency, amount: cents / 100 }));
}
