import { type Context, Hono } from "hono";
import {
  type ApiError,
  type DiscogsAccountResponse,
  type DiscogsListResponse,
  type DiscogsListsResponse,
  WantlistPushInputSchema,
  type WantlistPushResponse,
} from "../../shared/api.ts";
import { getRelease } from "../db/releases.ts";
import { DiscogsApiError } from "../discogs/client.ts";
import { listUserLists } from "../discogs/lists.ts";
import { listEntriesForApi, resolveListEntries } from "../importers/list.ts";
import { forgetWantlistItem, recordWantlistPush } from "../importers/seeds.ts";
import type { AppContext } from "../context.ts";
import {
  badRequest,
  parseJson,
  parseId,
  refuseInSandbox,
  wantlistAccount,
  discogsErrorMessage,
} from "./request.ts";

export function registerDiscogsRoutes(api: Hono, context: AppContext): void {
  api.get("/discogs/lists", (request) => discogsLists(request, context));
  api.get("/discogs/lists/:id", (request) => discogsList(request, context));
  api.get("/discogs/account", (request) => account(request, context));
  api.post("/discogs/wantlist/:id", (request) => pushWantlist(request, context));
  api.delete("/discogs/wantlist/:id", (request) => removeWantlist(request, context));
}

async function discogsLists(request: Context, context: AppContext) {
  const { username } = context.getConfig().discogs;
  if (username === "") return badRequest(request, "Set your Discogs username in Settings first");
  const lists = await listUserLists(context.getDiscogs(), username);
  const body: DiscogsListsResponse = {
    lists: lists.map((l) => ({ id: l.id, name: l.name, public: l.public })),
  };
  return request.json(body);
}

async function discogsList(request: Context, context: AppContext) {
  const { db, logger } = context;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid list id");
  const list = await context.getDiscogs().getList(id);
  const entries = await resolveListEntries(
    { db, discogs: context.getDiscogs(), logger },
    list.items,
    {
      currency: context.getConfig().discogs.currency,
    },
  );
  const body: DiscogsListResponse = {
    id: list.id,
    name: list.name,
    entries: listEntriesForApi(db, entries),
  };
  return request.json(body);
}

async function account(request: Context, context: AppContext) {
  const discogs = context.getDiscogs();
  const body: DiscogsAccountResponse = {
    username: context.getConfig().discogs.username,
    hasToken: discogs.hasToken(),
    tokenUsername: null,
    error: null,
  };
  if (body.hasToken) {
    try {
      body.tokenUsername = (await discogs.getIdentity()).username;
    } catch (e) {
      body.error = e instanceof DiscogsApiError ? discogsErrorMessage(e) : String(e);
    }
  }
  return request.json(body);
}

async function pushWantlist(request: Context, context: AppContext) {
  const { db, logger } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  const body = await parseJson(request, WantlistPushInputSchema);
  if (!body.ok) return body.response;
  const release = getRelease(db, id);
  if (!release) return request.json({ error: "Release not found" } satisfies ApiError, 404);
  const account = wantlistAccount(request, context);
  if ("response" in account) return account.response;
  await context.getDiscogs().addToWantlist(account.username, id, body.data);
  recordWantlistPush(db, release, body.data.notes ?? null);
  logger.info(`added release ${id} to the Discogs wantlist`);
  return request.json({ releaseId: id, ok: true } satisfies WantlistPushResponse);
}

async function removeWantlist(request: Context, context: AppContext) {
  const { db, logger } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  const account = wantlistAccount(request, context);
  if ("response" in account) return account.response;
  await context.getDiscogs().removeFromWantlist(account.username, id);
  forgetWantlistItem(db, id);
  logger.info(`removed release ${id} from the Discogs wantlist`);
  return request.json({ releaseId: id, ok: true } satisfies WantlistPushResponse);
}
