import { type Context, Hono } from "hono";
import {
  AddAlternativesSchema,
  AlternativesPreviewSchema,
  UndoAlternativesSchema,
} from "../../shared/alternative-pressings.ts";
import { previewAlternatives } from "../alternative-pressings.ts";
import type { AppContext } from "../context.ts";
import { addAlternativeWants, undoAlternativeWants } from "../wantlist-expansions.ts";
import { parseJson, wantlistAccount } from "./request.ts";

export function registerAlternativePressingRoutes(api: Hono, context: AppContext): void {
  // A receipt and its undo must never race another expansion's membership check.
  let writes: Promise<unknown> = Promise.resolve();
  const serialize = (operation: () => Promise<Response>) => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => undefined);
    return result;
  };
  api.post("/discogs/alternatives/preview", (c) => preview(c, context));
  api.post("/discogs/alternatives/add", (c) => serialize(() => add(c, context)));
  api.post("/discogs/alternatives/undo", (c) => serialize(() => undo(c, context)));
}

async function preview(c: Context, context: AppContext) {
  const body = await parseJson(c, AlternativesPreviewSchema);
  if (!body.ok) return body.response;
  return c.json(
    await previewAlternatives(
      {
        db: context.db,
        discogs: context.getDiscogs().withSignal(c.req.raw.signal),
        currency: context.getConfig().discogs.currency,
      },
      body.data,
    ),
  );
}

async function add(c: Context, context: AppContext) {
  const body = await parseJson(c, AddAlternativesSchema);
  if (!body.ok) return body.response;
  const account = wantlistAccount(c, context);
  if ("response" in account) return account.response;
  return c.json(
    await addAlternativeWants(
      {
        db: context.db,
        discogs: context.getDiscogs(),
        username: account.username,
        currency: context.getConfig().discogs.currency,
      },
      body.data,
    ),
  );
}

async function undo(c: Context, context: AppContext) {
  const body = await parseJson(c, UndoAlternativesSchema);
  if (!body.ok) return body.response;
  const account = wantlistAccount(c, context);
  if ("response" in account) return account.response;
  return c.json(
    await undoAlternativeWants(
      {
        db: context.db,
        discogs: context.getDiscogs(),
        username: account.username,
        currency: context.getConfig().discogs.currency,
      },
      body.data.operationId,
    ),
  );
}
