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
import { countRemaining, queryQueue } from "../queue/query.ts";
import { searchScopes } from "../queue/scopes.ts";
import { queryTwelves } from "../queue/twelves.ts";
import { listMarkedTracks } from "../queue/track-marks.ts";
import { computeStats } from "../stats.ts";
import type { AppContext } from "../context.ts";
import { badRequest, parseId, parseJson, parseQuery } from "./request.ts";
import { attachVideo } from "../attach-video.ts";
import { getRelease } from "../db/releases.ts";
import { youtubeIdFromUrl } from "../../shared/youtube.ts";
import { buildReleaseDetail } from "../queue/detail.ts";

export function registerCatalogRoutes(api: Hono, context: AppContext): void {
  api.get("/health", (request) => health(request));
  api.get("/queue", (request) => queueFromQuery(request, context));
  api.post("/queue", (request) => queueFromBody(request, context));
  api.get("/scopes", (request) => scopes(request, context));
  api.get("/releases/:id", (request) => release(request, context));
  api.post("/releases/:id/videos", (request) => attachVideoRoute(request, context));
  api.get("/twelves", (request) => twelves(request, context));
  api.get("/track-marks", (request) => trackMarks(request, context));
  api.get("/stats", (request) => stats(request, context));
}

function health(request: Context) {
  return request.json({ ok: true, name: "digga" });
}

function queueFromQuery(request: Context, context: AppContext) {
  const query = parseQuery(request, QueueQuerySchema);
  if (!query.ok) return query.response;
  return request.json(readQueue(context, query.data));
}

async function queueFromBody(request: Context, context: AppContext) {
  const body = await parseJson(request, QueueReadInputSchema);
  if (!body.ok) return body.response;
  return request.json(readQueue(context, body.data));
}

function readQueue(context: AppContext, read: QueueQuery & { exclude?: string[] }): QueueResponse {
  const config = context.getConfig();
  const strategy = read.strategy ?? config.queue.strategy;
  const filters = read.filters ?? config.filters;
  const scope = read.scope ?? null;
  const seed = strategy === "random" ? (read.seed ?? daySeed()) : null;
  const items = queryQueue(context.db, {
    filters,
    strategy,
    limit: read.limit ?? config.queue.limit,
    offset: read.offset,
    seed,
    scope,
    exclude: read.exclude,
  });
  return { items, remaining: countRemaining(context.db, filters, scope), strategy, seed, filters };
}

function scopes(request: Context, context: AppContext) {
  const query = parseQuery(request, ScopeSearchQuerySchema);
  if (!query.ok) return query.response;
  const body: ScopeSearchResponse = { items: searchScopes(context.db, query.data.q) };
  return request.json(body);
}

function release(request: Context, context: AppContext) {
  const { db } = context;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  const detail = buildReleaseDetail(db, id);
  if (!detail) return request.json({ error: "Release not found" } satisfies ApiError, 404);
  return request.json(detail);
}

async function attachVideoRoute(request: Context, context: AppContext) {
  const { db } = context;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  const body = await parseJson(request, AttachVideoInputSchema);
  if (!body.ok) return body.response;
  const videoId = youtubeIdFromUrl(body.data.url);
  if (videoId === null) return badRequest(request, "That is not a YouTube video link");
  const release = getRelease(db, id);
  if (!release) return request.json({ error: "Release not found" } satisfies ApiError, 404);
  await attachVideo({ db, lookupTitle: context.lookupVideoTitle }, release, videoId);
  return request.json(buildReleaseDetail(db, id));
}

function twelves(request: Context, context: AppContext) {
  const { db } = context;
  const query = parseQuery(request, TwelvesQuerySchema);
  if (!query.ok) return query.response;
  const config = context.getConfig();
  const filters = query.data.applyFilters ? config.filters : null;
  const body: TwelvesResponse = { items: queryTwelves(db, query.data.status, filters) };
  return request.json(body);
}

function trackMarks(request: Context, context: AppContext) {
  const body: TrackMarksResponse = { items: listMarkedTracks(context.db) };
  return request.json(body);
}

function stats(request: Context, context: AppContext) {
  const { db } = context;
  const query = parseQuery(request, StatsQuerySchema);
  if (!query.ok) return query.response;
  const config = context.getConfig();
  const filters = query.data.filters ?? config.filters;
  return request.json(computeStats(db, { ...config, filters }, query.data.scope ?? null));
}

function daySeed(): number {
  return Math.floor(Date.now() / 86400000);
}
