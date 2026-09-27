import fs from "node:fs";
import path from "node:path";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import {
  type ApiError,
  type DeleteVerdictResponse,
  type DiscogsListResponse,
  type DiscogsListsResponse,
  DumpLoadJobInputSchema,
  EnrichJobInputSchema,
  IMPORT_KINDS,
  ImportJobInputSchema,
  type ImportKind,
  type JobsResponse,
  ListenLogInputSchema,
  type ListenLogResponse,
  QueueQuerySchema,
  type QueueResponse,
  type ReleaseDetail,
  StatsQuerySchema,
  type TrackDetail,
  TrackVerdictInputSchema,
  TwelvesQuerySchema,
  type TwelvesItem,
  type TwelvesResponse,
  VerdictInputSchema,
} from "../shared/api.ts";
import { type Config, ConfigSchema } from "../shared/config.ts";
import { formatSummary } from "../shared/formats.ts";
import { readIdList } from "../../tools/dump/load.ts";
import type { Db } from "./db/db.ts";
import { countVideos, getRelease, getSiblings, getTracks, getVideos } from "./db/releases.ts";
import {
  deleteVerdict,
  getHeardKeys,
  getTrackVerdicts,
  getVerdict,
  listVerdicts,
  logListen,
  setTrackVerdict,
  upsertVerdict,
} from "./db/verdicts.ts";
import { DiscogsApiError, type DiscogsClient } from "./discogs/client.ts";
import type { DiscogsUserList } from "./discogs/types.ts";
import { listEntriesForApi, resolveListEntries } from "./importers/list.ts";
import {
  dumpLoad,
  enrich,
  importCollection,
  importHistory,
  importList,
  importWantlist,
} from "./jobs/index.ts";
import type { DumpLoadWorkerData } from "./jobs/dump-load-worker.ts";
import type { JobRunner } from "./jobs/runner.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";
import {
  buildFilterWhere,
  countRemaining,
  queryQueue,
  queueItemForRelease,
  representativeForKey,
} from "./queue/query.ts";
import { computeStats } from "./stats.ts";
import { createStaticHandler } from "./static.ts";

export interface AppContext {
  db: Db;
  paths: Paths;
  logger: Logger;
  jobs: JobRunner;
  getConfig(): Config;
  setConfig(config: Config): void;
  getDiscogs(): DiscogsClient;
  /** Serve dist/ for non-API routes (production). */
  serveStatic: boolean;
}

const DUMP_LOAD_WORKER = new URL("./jobs/dump-load-worker.ts", import.meta.url);

function badRequest(c: Context, message: string, issues?: unknown): Response {
  const body: ApiError = { error: message, issues };
  return c.json(body, 400);
}

async function parseJson<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: badRequest(c, "Body is not valid JSON") };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    return { ok: false, response: badRequest(c, "Invalid request body", result.error.issues) };
  return { ok: true, data: result.data };
}

function parseQuery<T>(
  c: Context,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; response: Response } {
  const result = schema.safeParse(c.req.query());
  if (!result.success)
    return { ok: false, response: badRequest(c, "Invalid query", result.error.issues) };
  return { ok: true, data: result.data };
}

function daySeed(): number {
  return Math.floor(Date.now() / 86_400_000);
}

export function buildReleaseDetail(db: Db, id: number): ReleaseDetail | null {
  const release = getRelease(db, id);
  if (!release) return null;
  const tracks = getTracks(db, id);
  const videos = getVideos(db, id);
  const heard = getHeardKeys(
    db,
    tracks.map((t) => t.heardKey),
  );
  const marks = new Map(getTrackVerdicts(db, id).map((tv) => [tv.position, tv]));
  const videoPositions = new Set(
    videos.map((v) => v.matchedPosition).filter((p): p is string => p !== null),
  );
  const trackDetails: TrackDetail[] = tracks.map((t) => ({
    ...t,
    heard: heard.has(t.heardKey),
    hasVideo: videoPositions.has(t.position),
    mark: marks.get(t.position)?.mark ?? null,
  }));
  return {
    release,
    tracks: trackDetails,
    videos,
    verdict: getVerdict(db, release.triageKey),
    trackVerdicts: [...marks.values()],
    siblings: getSiblings(db, release).map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      country: s.country,
      formatSummary: formatSummary(s.formats),
      labelName: s.labelName,
      catno: s.catno,
      isMainRelease: s.isMainRelease,
      videoCount: countVideos(db, s.id),
      inUniverse: s.inUniverse,
    })),
  };
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const api = new Hono();
  const { db, logger } = ctx;

  api.get("/health", (c) => c.json({ ok: true, name: "digga" }));

  api.get("/queue", (c) => {
    const q = parseQuery(c, QueueQuerySchema);
    if (!q.ok) return q.response;
    const config = ctx.getConfig();
    const strategy = q.data.strategy ?? config.queue.strategy;
    const filters = q.data.filters ?? config.filters;
    const seed = strategy === "random" ? (q.data.seed ?? daySeed()) : null;
    const items = queryQueue(db, {
      filters,
      strategy,
      limit: q.data.limit ?? config.queue.limit,
      offset: q.data.offset,
      seed,
    });
    const body: QueueResponse = {
      items,
      remaining: countRemaining(db, filters),
      strategy,
      seed,
      filters,
    };
    return c.json(body);
  });

  api.get("/releases/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return badRequest(c, "Invalid release id");
    const detail = buildReleaseDetail(db, id);
    if (!detail) return c.json({ error: "Release not found" } satisfies ApiError, 404);
    return c.json(detail);
  });

  api.post("/verdicts", async (c) => {
    const body = await parseJson(c, VerdictInputSchema);
    if (!body.ok) return body.response;
    const v = upsertVerdict(db, body.data);
    return c.json(v);
  });

  api.delete("/verdicts/:key", (c) => {
    const previous = deleteVerdict(db, c.req.param("key"));
    const body: DeleteVerdictResponse = { deleted: previous !== null, previous };
    return c.json(body);
  });

  api.post("/track-verdicts", async (c) => {
    const body = await parseJson(c, TrackVerdictInputSchema);
    if (!body.ok) return body.response;
    return c.json(setTrackVerdict(db, body.data));
  });

  api.post("/listen-log", async (c) => {
    const body = await parseJson(c, ListenLogInputSchema);
    if (!body.ok) return body.response;
    const r = logListen(db, { ...body.data, position: body.data.position ?? null });
    const res: ListenLogResponse = { id: r.id, heardKey: r.heardKey };
    return c.json(res);
  });

  api.get("/twelves", (c) => {
    const q = parseQuery(c, TwelvesQuerySchema);
    if (!q.ok) return q.response;
    const config = ctx.getConfig();
    const where = buildFilterWhere(config.filters, { includeDecided: true });
    const passes = db.prepare(`SELECT 1 FROM releases r WHERE r.id = ? AND ${where.sql}`);
    const items: TwelvesItem[] = [];
    for (const verdict of listVerdicts(db, q.data.status)) {
      const release =
        (verdict.releaseId !== null ? queueItemForRelease(db, verdict.releaseId) : null) ??
        representativeForKey(db, verdict.key);
      if (
        q.data.applyFilters &&
        (release === null || passes.get(release.id, ...where.params) === undefined)
      )
        continue;
      items.push({ verdict, release });
    }
    const body: TwelvesResponse = { items, statuses: q.data.status };
    return c.json(body);
  });

  api.get("/stats", (c) => {
    const q = parseQuery(c, StatsQuerySchema);
    if (!q.ok) return q.response;
    const config = ctx.getConfig();
    return c.json(computeStats(db, { ...config, filters: q.data.filters ?? config.filters }));
  });

  api.get("/settings", (c) => c.json(ctx.getConfig()));

  api.put("/settings", async (c) => {
    const body = await parseJson(c, ConfigSchema);
    if (!body.ok) return body.response;
    ctx.setConfig(body.data);
    return c.json(ctx.getConfig());
  });

  api.post("/jobs/enrich", async (c) => {
    const body = await parseJson(c, EnrichJobInputSchema);
    if (!body.ok) return body.response;
    const config = ctx.getConfig();
    const job = ctx.jobs.run("enrich", ({ signal, onProgress }) =>
      enrich(
        { db, discogs: ctx.getDiscogs(), logger },
        {
          ahead: body.data.ahead,
          currency: config.discogs.currency,
          filters: config.filters,
          strategy: config.queue.strategy,
          signal,
        },
        onProgress,
      ),
    );
    return c.json(job, 202);
  });

  api.post("/jobs/dump-load", async (c) => {
    const body = await parseJson(c, DumpLoadJobInputSchema);
    if (!body.ok) return body.response;
    const config = ctx.getConfig();
    const resolveFile = (f: string) =>
      f === "-" || path.isAbsolute(f) ? f : path.resolve(ctx.paths.dumpsDir, f);
    const file = resolveFile(body.data.file);
    if (file === "-") return badRequest(c, "stdin is only supported from the CLI");
    if (!fs.existsSync(file)) return badRequest(c, `Dump file not found: ${file}`);
    const labelsFile = body.data.labelsFile ? resolveFile(body.data.labelsFile) : undefined;
    const artistsFile = body.data.artistsFile ? resolveFile(body.data.artistsFile) : undefined;
    const workerData: DumpLoadWorkerData = {
      dbFile: ctx.paths.dbFile,
      options: {
        file,
        styles: config.universe.styles,
        loadYears: config.universe.loadYears,
        limit: body.data.limit,
        dryRun: body.data.dryRun,
        labelIds: labelsFile ? readIdList(labelsFile) : undefined,
        artistIds: artistsFile ? readIdList(artistsFile) : undefined,
      },
    };
    if (ctx.paths.dbFile === ":memory:") {
      // Tests and ad-hoc in-memory servers cannot share a connection with a worker.
      const job = ctx.jobs.run("dump_load", ({ onProgress }) =>
        dumpLoad({ db, logger }, workerData.options, onProgress),
      );
      return c.json(job, 202);
    }
    const job = ctx.jobs.runInWorker("dump_load", DUMP_LOAD_WORKER, workerData);
    return c.json(job, 202);
  });

  api.post("/jobs/import/:kind", async (c) => {
    const kind = c.req.param("kind") as ImportKind;
    if (!IMPORT_KINDS.includes(kind))
      return badRequest(c, `Unknown import kind; expected one of ${IMPORT_KINDS.join(", ")}`);
    const body = await parseJson(c, ImportJobInputSchema);
    if (!body.ok) return body.response;
    const config = ctx.getConfig();
    if (kind === "list") {
      const listId = body.data.listId ?? config.discogs.maybeListId;
      if (listId === null) return badRequest(c, "Choose your Discogs Maybe list in Settings first");
      const job = ctx.jobs.run("import_list", ({ signal, onProgress }) =>
        importList(
          { db, discogs: ctx.getDiscogs(), logger },
          { listId, currency: config.discogs.currency, signal },
          onProgress,
        ),
      );
      return c.json(job, 202);
    }
    if (kind === "history") {
      const job = ctx.jobs.run("import_history", ({ signal, onProgress }) =>
        importHistory(
          { db, logger },
          { browser: body.data.browser, path: body.data.path, tempDir: ctx.paths.tempDir, signal },
          onProgress,
        ),
      );
      return c.json(job, 202);
    }
    const deps = { db, discogs: ctx.getDiscogs(), logger };
    const job =
      kind === "collection"
        ? ctx.jobs.run("import_collection", ({ signal, onProgress }) =>
            importCollection(deps, { username: config.discogs.username, signal }, onProgress),
          )
        : ctx.jobs.run("import_wantlist", ({ signal, onProgress }) =>
            importWantlist(deps, { username: config.discogs.username, signal }, onProgress),
          );
    return c.json(job, 202);
  });

  api.get("/jobs", (c) => {
    const body: JobsResponse = { jobs: ctx.jobs.list() };
    return c.json(body);
  });

  api.get("/jobs/:id", (c) => {
    const job = ctx.jobs.get(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" } satisfies ApiError, 404);
    return c.json(job);
  });

  api.post("/jobs/:id/cancel", (c) => {
    const id = c.req.param("id");
    const cancelled = ctx.jobs.cancel(id);
    const job = ctx.jobs.get(id);
    if (!job) return c.json({ error: "Job not found" } satisfies ApiError, 404);
    return c.json({ cancelled, job });
  });

  api.get("/discogs/lists", async (c) => {
    const { username } = ctx.getConfig().discogs;
    if (username === "") return badRequest(c, "Set your Discogs username in Settings first");
    const lists: DiscogsUserList[] = [];
    for (let page = 1; ; page += 1) {
      const data = await ctx.getDiscogs().getUserLists(username, page);
      lists.push(...data.lists);
      if (page >= data.pagination.pages || data.lists.length === 0) break;
    }
    const body: DiscogsListsResponse = {
      lists: lists.map((l) => ({ id: l.id, name: l.name, public: l.public })),
    };
    return c.json(body);
  });

  api.get("/discogs/lists/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return badRequest(c, "Invalid list id");
    const list = await ctx.getDiscogs().getList(id);
    const entries = await resolveListEntries(
      { db, discogs: ctx.getDiscogs(), logger },
      list.items,
      {
        currency: ctx.getConfig().discogs.currency,
      },
    );
    const body: DiscogsListResponse = {
      id: list.id,
      name: list.name,
      entries: listEntriesForApi(db, entries),
    };
    return c.json(body);
  });

  api.post("/discogs/wantlist/:id", (c) =>
    c.json(
      { error: "Pushing to the Discogs wantlist is planned for session 3" } satisfies ApiError,
      501,
    ),
  );

  app.route("/api", api);
  // Hono applies notFound/onError of the root app only, so the API fallbacks live here.
  app.all("/api/*", (c) =>
    c.json({ error: `No such API route: ${c.req.method} ${c.req.path}` } satisfies ApiError, 404),
  );
  app.onError((err, c) => {
    if (err instanceof DiscogsApiError) {
      logger.warn(`${c.req.method} ${c.req.path}: Discogs answered ${err.status}`);
      return c.json({ error: `Discogs answered ${err.status}` } satisfies ApiError, 502);
    }
    logger.error(`${c.req.method} ${c.req.path} failed`, err);
    return c.json({ error: err.message } satisfies ApiError, 500);
  });
  if (ctx.serveStatic) {
    const serveDist = createStaticHandler(ctx.paths.distDir);
    app.get("*", (c) => serveDist(c));
  }
  return app;
}
