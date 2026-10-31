import { type Context, Hono } from "hono";
import {
  type ApiError,
  type DiscogsAccountResponse,
  type DiscogsListsResponse,
  DiscogsProfileQuerySchema,
  type DiscogsProfileResponse,
  DiscogsTokenInputSchema,
  type ForgetDiscogsDataResponse,
  type WantlistPushResponse,
} from "../../shared/api.ts";
import { DISCOGS_CURRENCIES } from "../../shared/config.ts";
import { accountConflict, forgetAccountData, heldAccount } from "../db/memberships.ts";
import { getRelease } from "../db/releases.ts";
import { DiscogsApiError } from "../discogs/client.ts";
import { listUserLists } from "../discogs/lists.ts";
import type { DiscogsUser } from "../discogs/types.ts";
import { enrichRelease } from "../enrich.ts";
import { buildReleaseDetail } from "../queue/detail.ts";
import { forgetWantlistItem, recordWantlistPush, wantlistNoteFor } from "../importers/seeds.ts";
import type { AppContext } from "../context.ts";
import {
  badRequest,
  discogsErrorMessage,
  paramId,
  parseJson,
  parseQuery,
  wantlistAccount,
} from "./request.ts";

export function registerDiscogsRoutes(api: Hono, context: AppContext): void {
  api.get("/discogs/lists", (c) => discogsLists(c, context));
  api.get("/discogs/account", (c) => account(c, context));
  api.get("/discogs/profile", (c) => profile(c, context));
  api.put("/discogs/token", (c) => saveToken(c, context));
  api.delete("/discogs/data", (c) => forgetData(c, context));
  api.post("/discogs/wantlist/:id", (c) => pushWantlist(c, context));
  api.delete("/discogs/wantlist/:id", (c) => removeWantlist(c, context));
  api.post("/releases/:id/enrich", (c) => enrichOne(c, context));
}

/** Fetches one release from Discogs for `P` in Triage and returns it as stored. */
async function enrichOne(c: Context, context: AppContext) {
  const { db, logger } = context;
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  if (!getRelease(db, id)) return c.json({ error: "Release not found" } satisfies ApiError, 404);
  const deps = { db, discogs: context.getDiscogs(), logger };
  const enriched = await enrichRelease(deps, id, context.getConfig().discogs.currency);
  if (!enriched)
    return c.json({ error: "Discogs did not return the release" } satisfies ApiError, 502);
  return c.json(buildReleaseDetail(db, id));
}

async function discogsLists(c: Context, context: AppContext) {
  const { username } = context.getConfig().discogs;
  if (username === "") return badRequest(c, "Set your Discogs username in Settings first");
  const lists = await listUserLists(context.getDiscogs(), username);
  const body: DiscogsListsResponse = {
    lists: lists.map((list) => ({ id: list.id, name: list.name, public: list.public })),
  };
  return c.json(body);
}

async function account(c: Context, context: AppContext) {
  const identity = context.getDiscogs().hasToken() ? await askIdentity(context) : null;
  return c.json(accountResponse(context, identity));
}

/** Whose token it is, from one request to Discogs; `refused` when Discogs rejected the token. */
type Identity = { username: string } | { error: string; refused: boolean };

async function askIdentity(context: AppContext): Promise<Identity> {
  try {
    return { username: (await context.getDiscogs().getIdentity()).username };
  } catch (error) {
    if (!(error instanceof DiscogsApiError)) return { error: String(error), refused: false };
    return { error: discogsErrorMessage(error), refused: [401, 403].includes(error.status) };
  }
}

/** Whether a token is set and whose it is, and whose Discogs data the library holds. */
function accountResponse(context: AppContext, identity: Identity | null): DiscogsAccountResponse {
  const { username } = context.getConfig().discogs;
  return {
    username,
    hasToken: context.getDiscogs().hasToken(),
    tokenSource: context.secrets.discogsTokenSource(),
    tokenEncrypted: context.secrets.discogsTokenEncrypted(),
    tokenUsername: identity && "username" in identity ? identity.username : null,
    error: identity && "error" in identity ? identity.error : null,
    dataAccount: heldAccount(context.db, username),
  };
}

/** The user's public profile; null when Discogs has no user of that name. */
async function findUser(context: AppContext, username: string): Promise<DiscogsUser | null> {
  try {
    return await context.getDiscogs().getUser(username);
  } catch (error) {
    if (error instanceof DiscogsApiError && error.status === 404) return null;
    throw error;
  }
}

/** The collection and wantlist sizes and the currency of the account, for the setup. */
async function profile(c: Context, context: AppContext) {
  const query = parseQuery(c, DiscogsProfileQuerySchema);
  if (!query.ok) return query.response;
  const username = query.data.username ?? context.getConfig().discogs.username;
  if (username === "") return badRequest(c, "Connect your Discogs account first");
  const user = await findUser(context, username);
  if (!user) return c.json({ error: `No Discogs user named ${username}` } satisfies ApiError, 404);
  const body: DiscogsProfileResponse = {
    username: user.username,
    collection: user.num_collection ?? null,
    wantlist: user.num_wantlist ?? null,
    currency: DISCOGS_CURRENCIES.find((currency) => currency === user.curr_abbr) ?? null,
  };
  return c.json(body);
}

/**
 * A token Discogs refuses, or one of another account than the library's Discogs data, is not kept. The first token sets the Discogs
 * username, so nobody has to type it.
 */
async function saveToken(c: Context, context: AppContext) {
  const body = await parseJson(c, DiscogsTokenInputSchema);
  if (!body.ok) return body.response;
  if (context.secrets.discogsTokenSource() === "environment")
    return c.json(
      {
        error:
          "DISCOGS_TOKEN is set in the environment or in the .env digga started with, which overrides the saved token; remove it there to change the token here",
      } satisfies ApiError,
      409,
    );
  const token = body.data.token;
  const previous = context.secrets.getDiscogsToken() ?? null;
  context.secrets.setDiscogsToken(token);
  if (token === null) {
    context.logger.info("Discogs token removed");
    return c.json(accountResponse(context, null));
  }

  const identity = await askIdentity(context);
  const refusal = tokenRefusal(context, identity);
  if (refusal !== null) {
    context.secrets.setDiscogsToken(previous);
    return c.json({ error: refusal.error } satisfies ApiError, refusal.status);
  }
  if ("username" in identity) adoptUsername(context, identity.username);
  context.logger.info("Discogs token saved");
  return c.json(accountResponse(context, identity));
}

function tokenRefusal(
  context: AppContext,
  identity: Identity,
): { error: string; status: 400 | 409 } | null {
  if ("refused" in identity && identity.refused)
    return {
      error: "Discogs did not accept this token. Copy it again from discogs.com",
      status: 400,
    };
  if (!("username" in identity)) return null;
  const configured = context.getConfig().discogs.username;
  const conflict = accountConflict(context.db, identity.username, configured);
  return conflict === null ? null : { error: conflict, status: 409 };
}

function adoptUsername(context: AppContext, username: string): void {
  const config = context.getConfig();
  if (config.discogs.username !== "") return;
  context.setConfig({ ...config, discogs: { ...config.discogs, username } });
}

/**
 * Forgets the collection, wantlist and Maybe list the library holds, so another Discogs account
 * can be used. Verdicts, notes and marks stay; the next imports read the account again.
 */
function forgetData(c: Context, context: AppContext) {
  const forgotten = forgetAccountData(context.db);
  context.logger.info(`forgot ${forgotten} Discogs collection, wantlist and list items`);
  return c.json({ forgotten } satisfies ForgetDiscogsDataResponse);
}

async function pushWantlist(c: Context, context: AppContext) {
  const { db, logger } = context;
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  const release = getRelease(db, id);
  if (!release) return c.json({ error: "Release not found" } satisfies ApiError, 404);
  const account = wantlistAccount(c, context);
  if ("response" in account) return account.response;
  const notes = wantlistNoteFor(db, release);
  await context.getDiscogs().addToWantlist(account.username, id, { notes });
  recordWantlistPush(db, release, notes ?? null);
  logger.info(`added release ${id} to the Discogs wantlist`);
  return c.json({ releaseId: id, ok: true } satisfies WantlistPushResponse);
}

async function removeWantlist(c: Context, context: AppContext) {
  const { db, logger } = context;
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  const account = wantlistAccount(c, context);
  if ("response" in account) return account.response;
  await context.getDiscogs().removeFromWantlist(account.username, id);
  forgetWantlistItem(db, id);
  logger.info(`removed release ${id} from the Discogs wantlist`);
  return c.json({ releaseId: id, ok: true } satisfies WantlistPushResponse);
}
