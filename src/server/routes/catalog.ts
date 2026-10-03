import { type Context, Hono } from "hono";
import {
  type ApiError,
  AttachVideoInputSchema,
  QueueQuerySchema,
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
  api.get("/queue", (request) => queue(request, context));
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

function queue(request: Context, context: AppContext) {
  const { db } = context;
  const query = parseQuery(request, QueueQuerySchema);
  if (!query.ok) return query.response;
  const config = context.getConfig();
  const strategy = query.data.strategy ?? config.queue.strategy;
  const filters = query.data.filters ?? config.filters;
  const scope = query.data.scope ?? null;
  const seed = strategy === "random" ? (query.data.seed ?? daySeed()) : null;
  const items = queryQueue(db, {
    filters,
    strategy,
    limit: query.data.limit ?? config.queue.limit,
    offset: query.data.offset,
    seed,
    scope,
  });
  const body: QueueResponse = {
    items,
    remaining: countRemaining(db, filters, scope),
    strategy,
    seed,
    filters,
  };
  return request.json(body);
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
  const requeue = !context.getConfig().sandbox;
  await attachVideo({ db, lookupTitle: context.lookupVideoTitle }, release, { videoId, requeue });
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
