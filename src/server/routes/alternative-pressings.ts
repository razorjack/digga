import { type Context, Hono } from "hono";
import {
  AddAlternativesBatchSchema,
  AlternativesPreviewSchema,
  UndoAlternativesSchema,
  type AlternativesProgress,
} from "../../shared/alternative-pressings.ts";
import { previewAlternatives } from "../alternative-pressings.ts";
import type { AppContext } from "../context.ts";
import { addAlternativeWants, undoAlternativeWants } from "../wantlist-expansions.ts";
import { parseJson, wantlistAccount } from "./request.ts";

/** The progress of each batch of additions while it runs, by `batchId`. */
type RunningBatches = Map<string, AlternativesProgress>;

export function registerAlternativePressingRoutes(api: Hono, context: AppContext): void {
  const batches: RunningBatches = new Map();
  // A receipt and its undo must never race another expansion's membership check.
  let writes: Promise<unknown> = Promise.resolve();
  const serialize = (operation: () => Promise<Response>) => {
    const result = writes.then(operation, operation);
    writes = result.catch(() => undefined);
    return result;
  };
  api.post("/discogs/alternatives/preview", (c) => preview(c, context));
  api.post("/discogs/alternatives/add", (c) => serialize(() => add(c, context, batches)));
  api.get("/discogs/alternatives/batches/:batchId", (c) => batchProgress(c, batches));
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

async function add(c: Context, context: AppContext, batches: RunningBatches) {
  const body = await parseJson(c, AddAlternativesBatchSchema);
  if (!body.ok) return body.response;
  const account = wantlistAccount(c, context);
  if ("response" in account) return account.response;
  const { batchId, additions } = body.data;
  try {
    const results = await addAlternativeWants(
      {
        db: context.db,
        discogs: context.getDiscogs(),
        username: account.username,
        currency: context.getConfig().discogs.currency,
      },
      additions,
      (progress) => batches.set(batchId, progress),
    );
    return c.json(results);
  } finally {
    batches.delete(batchId);
  }
}

/** Null while the batch waits behind another one, and after it has finished. */
function batchProgress(c: Context, batches: RunningBatches) {
  return c.json(batches.get(c.req.param("batchId") ?? "") ?? null);
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
