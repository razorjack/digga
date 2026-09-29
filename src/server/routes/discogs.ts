import { type Context, Hono } from "hono";
import {
  type ApiError,
  type DiscogsAccountResponse,
  type DiscogsListResponse,
  type DiscogsListsResponse,
  DiscogsTokenInputSchema,
  type WantlistPushResponse,
} from "../../shared/api.ts";
import { getRelease } from "../db/releases.ts";
import { DiscogsApiError } from "../discogs/client.ts";
import { listUserLists } from "../discogs/lists.ts";
import { listEntriesForApi, resolveListEntries } from "../importers/list.ts";
import { enrichRelease } from "../enrich.ts";
import { buildReleaseDetail } from "../queue/detail.ts";
import { forgetWantlistItem, recordWantlistPush, wantlistNoteFor } from "../importers/seeds.ts";
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
  api.put("/discogs/token", (request) => saveToken(request, context));
  api.post("/discogs/wantlist/:id", (request) => pushWantlist(request, context));
  api.delete("/discogs/wantlist/:id", (request) => removeWantlist(request, context));
  api.post("/releases/:id/enrich", (request) => enrichOne(request, context));
}

/** Fetches one release from Discogs for `P` in Triage and returns it as stored. */
async function enrichOne(request: Context, context: AppContext) {
  const { db, logger } = context;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  if (!getRelease(db, id))
    return request.json({ error: "Release not found" } satisfies ApiError, 404);
  const deps = { db, discogs: context.getDiscogs(), logger };
  const enriched = await enrichRelease(deps, id, context.getConfig().discogs.currency);
  if (!enriched)
    return request.json({ error: "Discogs did not return the release" } satisfies ApiError, 502);
  return request.json(buildReleaseDetail(db, id));
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
  return request.json(await accountResponse(context));
}

/** Whether a token is set and whose it is; asks Discogs once. */
async function accountResponse(context: AppContext): Promise<DiscogsAccountResponse> {
  const discogs = context.getDiscogs();
  const body: DiscogsAccountResponse = {
    username: context.getConfig().discogs.username,
    hasToken: discogs.hasToken(),
    tokenSource: context.secrets.discogsTokenSource(),
    tokenUsername: null,
    error: null,
  };
  if (body.hasToken) {
    try {
      body.tokenUsername = (await discogs.getIdentity()).username;
    } catch (error) {
      body.error = error instanceof DiscogsApiError ? discogsErrorMessage(error) : String(error);
    }
  }
  return body;
}

/** Setup rather than digging, so the sandbox does not refuse it. */
async function saveToken(request: Context, context: AppContext) {
  const body = await parseJson(request, DiscogsTokenInputSchema);
  if (!body.ok) return body.response;
  if (context.secrets.discogsTokenSource() === "environment")
    return request.json(
      {
        error:
          "DISCOGS_TOKEN is set in the environment, which overrides the saved token; unset it to change the token here",
      } satisfies ApiError,
      409,
    );
  context.secrets.setDiscogsToken(body.data.token);
  context.logger.info(body.data.token === null ? "Discogs token removed" : "Discogs token saved");
  return request.json(await accountResponse(context));
}

async function pushWantlist(request: Context, context: AppContext) {
  const { db, logger } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  const release = getRelease(db, id);
  if (!release) return request.json({ error: "Release not found" } satisfies ApiError, 404);
  const account = wantlistAccount(request, context);
  if ("response" in account) return account.response;
  const notes = wantlistNoteFor(db, release);
  await context.getDiscogs().addToWantlist(account.username, id, { notes });
  recordWantlistPush(db, release, notes ?? null);
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
