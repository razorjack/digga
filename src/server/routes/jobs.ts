import { type Context, Hono } from "hono";
import {
  type ApiError,
  DumpLoadJobInputSchema,
  EnrichJobInputSchema,
  IMPORT_KINDS,
  ImportJobInputSchema,
  type JobsResponse,
} from "../../shared/api.ts";
import { enrich } from "../jobs/enrich.ts";
import { startDumpLoad, startImport } from "../jobs/start.ts";
import type { AppContext } from "../context.ts";
import { badRequest, parseJson, refuseInSandbox } from "./request.ts";

export function registerJobsRoutes(api: Hono, context: AppContext): void {
  api.post("/jobs/enrich", (request) => enrichJob(request, context));
  api.post("/jobs/dump-load", (request) => dumpJob(request, context));
  api.post("/jobs/import/:kind", (request) => importJob(request, context));
  api.get("/jobs", (request) => jobs(request, context));
  api.get("/jobs/:id", (request) => job(request, context));
  api.post("/jobs/:id/cancel", (request) => cancelJob(request, context));
}

async function enrichJob(request: Context, context: AppContext) {
  const { db, logger } = context;
  const body = await parseJson(request, EnrichJobInputSchema);
  if (!body.ok) return body.response;
  const config = context.getConfig();
  const job = context.jobs.run("enrich", ({ signal, onProgress }) =>
    enrich(
      { db, discogs: context.getDiscogs(), logger },
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
  return request.json(job, 202);
}

async function dumpJob(request: Context, context: AppContext) {
  const body = await parseJson(request, DumpLoadJobInputSchema);
  if (!body.ok) return body.response;
  const job = startDumpLoad(context, body.data);
  return request.json(job, 202);
}

async function importJob(request: Context, context: AppContext) {
  const kind = IMPORT_KINDS.find((kind) => kind === request.req.param("kind"));
  if (!kind)
    return badRequest(request, `Unknown import kind; expected one of ${IMPORT_KINDS.join(", ")}`);
  const body = await parseJson(request, ImportJobInputSchema);
  if (!body.ok) return body.response;
  if (kind === "list") {
    const refused = refuseInSandbox(request, context);
    if (refused) return refused;
  }
  const job = startImport(context, kind, body.data);
  return request.json(job, 202);
}

function jobs(request: Context, context: AppContext) {
  const body: JobsResponse = { jobs: context.jobs.list() };
  return request.json(body);
}

function job(request: Context, context: AppContext) {
  const job = context.jobs.get(request.req.param("id") ?? "");
  if (!job) return request.json({ error: "Job not found" } satisfies ApiError, 404);
  return request.json(job);
}

function cancelJob(request: Context, context: AppContext) {
  const id = request.req.param("id") ?? "";
  const cancelled = context.jobs.cancel(id);
  const job = context.jobs.get(id);
  if (!job) return request.json({ error: "Job not found" } satisfies ApiError, 404);
  return request.json({ cancelled, job });
}
