import { type Context, type Hono } from "hono";
import { ShoppingDecisionSchema } from "../../shared/shopping.ts";
import type { AppContext } from "../context.ts";
import { saveShoppingDecision, shoppingQueue, shoppingSellers } from "../queue/shopping.ts";
import { badRequest, paramId, parseJson } from "./request.ts";

export function registerShoppingRoutes(api: Hono, context: AppContext): void {
  api.get("/shopping", (c) => c.json({ sellers: shoppingSellers(context.db) }));
  api.get("/shopping/:seller", (c) => shop(c, context));
  api.put("/shopping/:seller/:listing", (c) => decide(c, context));
}

function shop(c: Context, context: AppContext) {
  const sellerId = paramId(c, "seller");
  if (sellerId === null) return badRequest(c, "Invalid seller id");
  const queue = shoppingQueue(context.db, sellerId);
  if (!queue) return c.json({ error: "Read this seller's shop first" }, 404);
  return c.json(queue);
}

async function decide(c: Context, context: AppContext) {
  const sellerId = paramId(c, "seller");
  const listingId = paramId(c, "listing");
  if (sellerId === null || listingId === null) return badRequest(c, "Invalid seller or listing id");
  const body = await parseJson(c, ShoppingDecisionSchema);
  if (!body.ok) return body.response;
  const queue = saveShoppingDecision(context.db, sellerId, listingId, body.data.state);
  if (!queue) return c.json({ error: "This copy is not in the seller's shopping queue" }, 404);
  return c.json(queue);
}
