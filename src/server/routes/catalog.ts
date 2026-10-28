import { type Context, Hono } from "hono";
import {
  type ApiError,
  AttachVideoInputSchema,
  type QueueQuery,
  QueueQuerySchema,
  QueueReadInputSchema,
  type QueueResponse,
  ScopeSearchQuerySchema,
  type ScopeSearchResponse,
  StatsQuerySchema,
  type TrackMarksResponse,
  TwelvesQuerySchema,
  type TwelvesResponse,
} from "../../shared/api.ts";
import { searchScopes } from "../queue/scopes.ts";
import { queryTwelves } from "../queue/twelves.ts";
import { listMarkedTracks } from "../queue/track-marks.ts";
import type { AppContext } from "../context.ts";
import { badRequest, paramId, parseJson, parseQuery } from "./request.ts";
import { attachVideo } from "../attach-video.ts";
import { getRelease } from "../db/releases.ts";
import { youtubeIdFromUrl } from "../../shared/youtube.ts";
import { buildReleaseDetail } from "../queue/detail.ts";

export function registerCatalogRoutes(api: Hono, context: AppContext): void {
  api.get("/health", (c) => health(c));
  api.get("/queue", (c) => queueFromQuery(c, context));
  api.post("/queue", (c) => queueFromBody(c, context));
  api.get("/scopes", (c) => scopes(c, context));
  api.get("/releases/:id", (c) => release(c, context));
  api.post("/releases/:id/videos", (c) => attachVideoRoute(c, context));
  api.get("/twelves", (c) => twelves(c, context));
  api.get("/track-marks", (c) => trackMarks(c, context));
  api.get("/stats", (c) => stats(c, context));
}

function health(c: Context) {
  return c.json({ ok: true, name: "digga" });
}

async function queueFromQuery(c: Context, context: AppContext) {
  const query = parseQuery(c, QueueQuerySchema);
  if (!query.ok) return query.response;
  return c.json(await readQueue(context, query.data));
}

async function queueFromBody(c: Context, context: AppContext) {
  const body = await parseJson(c, QueueReadInputSchema);
  if (!body.ok) return body.response;
  return c.json(await readQueue(context, body.data));
}

async function readQueue(
  context: AppContext,
  read: QueueQuery & { exclude?: string[] },
): Promise<QueueResponse> {
  const config = context.getConfig();
  const strategy = read.strategy ?? config.queue.strategy;
  const filters = read.filters ?? config.filters;
  const scope = read.scope ?? null;
  const seed = strategy === "random" ? (read.seed ?? daySeed()) : null;
  const page = await context.reader.queue({
    filters,
    strategy,
    limit: read.limit ?? config.queue.limit,
    offset: read.offset,
    seed,
    scope,
    exclude: read.exclude,
  });
  return { ...page, strategy, seed, filters };
}

function scopes(c: Context, context: AppContext) {
  const query = parseQuery(c, ScopeSearchQuerySchema);
  if (!query.ok) return query.response;
  const body: ScopeSearchResponse = { items: searchScopes(context.db, query.data.q) };
  return c.json(body);
}

function release(c: Context, context: AppContext) {
  const { db } = context;
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  const detail = buildReleaseDetail(db, id);
  if (!detail) return c.json({ error: "Release not found" } satisfies ApiError, 404);
  return c.json(detail);
}

async function attachVideoRoute(c: Context, context: AppContext) {
  const { db } = context;
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  const body = await parseJson(c, AttachVideoInputSchema);
  if (!body.ok) return body.response;
  const videoId = youtubeIdFromUrl(body.data.url);
  if (videoId === null) return badRequest(c, "That is not a YouTube video link");
  const release = getRelease(db, id);
  if (!release) return c.json({ error: "Release not found" } satisfies ApiError, 404);
  await attachVideo({ db, lookupTitle: context.lookupVideoTitle }, release, videoId);
  return c.json(buildReleaseDetail(db, id));
}

function twelves(c: Context, context: AppContext) {
  const { db } = context;
  const query = parseQuery(c, TwelvesQuerySchema);
  if (!query.ok) return query.response;
  const config = context.getConfig();
  const filters = query.data.applyFilters ? config.filters : null;
  const body: TwelvesResponse = { items: queryTwelves(db, query.data.status, filters) };
  return c.json(body);
}

function trackMarks(c: Context, context: AppContext) {
  const body: TrackMarksResponse = { items: listMarkedTracks(context.db) };
  return c.json(body);
}

async function stats(c: Context, context: AppContext) {
  const query = parseQuery(c, StatsQuerySchema);
  if (!query.ok) return query.response;
  const config = context.getConfig();
  const filters = query.data.filters ?? config.filters;
  return c.json(await context.reader.stats({ ...config, filters }, query.data.scope ?? null));
}

function daySeed(): number {
  return Math.floor(Date.now() / 86400000);
}
