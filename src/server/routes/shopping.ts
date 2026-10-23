import { type Context, type Hono } from "hono";
import { ShoppingDecisionSchema } from "../../shared/shopping.ts";
import type { AppContext } from "../context.ts";
import { saveShoppingDecision, shoppingQueue, shoppingSellers } from "../queue/shopping.ts";
import { badRequest, parseId, parseJson } from "./request.ts";

export function registerShoppingRoutes(api: Hono, context: AppContext): void {
  api.get("/shopping", (request) => request.json({ sellers: shoppingSellers(context.db) }));
  api.get("/shopping/:seller", (request) => shop(request, context));
  api.put("/shopping/:seller/:listing", (request) => decide(request, context));
}

function shop(request: Context, context: AppContext) {
  const sellerId = parseId(request.req.param("seller") ?? "");
  if (sellerId === null) return badRequest(request, "Invalid seller id");
  const queue = shoppingQueue(context.db, sellerId);
  if (!queue) return request.json({ error: "Read this seller's shop first" }, 404);
  return request.json(queue);
}

async function decide(request: Context, context: AppContext) {
  const sellerId = parseId(request.req.param("seller") ?? "");
  const listingId = parseId(request.req.param("listing") ?? "");
  if (sellerId === null || listingId === null)
    return badRequest(request, "Invalid seller or listing id");
  const body = await parseJson(request, ShoppingDecisionSchema);
  if (!body.ok) return body.response;
  const queue = saveShoppingDecision(context.db, sellerId, listingId, body.data.state);
  if (!queue)
    return request.json({ error: "This copy is not in the seller's shopping queue" }, 404);
  return request.json(queue);
}
