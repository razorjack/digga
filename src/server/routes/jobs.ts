import { type Context, Hono } from "hono";
import {
  type ApiError,
  type DumpsResponse,
  DumpLoadJobInputSchema,
  IMPORT_KINDS,
  ImportJobInputSchema,
  type JobsResponse,
} from "../../shared/api.ts";
import { deleteDumpFile, listDumpFiles } from "../dump-files.ts";
import {
  refuseWhileDumpJobRuns,
  startDumpDownload,
  startDumpLoad,
  startDumpUpdate,
  startImport,
} from "../jobs/start.ts";
import type { AppContext } from "../context.ts";
import { badRequest, parseJson } from "./request.ts";

export function registerJobsRoutes(api: Hono, context: AppContext): void {
  api.post("/jobs/dump-download", (c) => dumpDownloadJob(c, context));
  api.post("/jobs/dump-load", (c) => dumpJob(c, context));
  api.post("/jobs/dump-update", (c) => dumpUpdateJob(c, context));
  api.post("/jobs/import/:kind", (c) => importJob(c, context));
  api.get("/jobs", (c) => jobs(c, context));
  api.get("/dumps", (c) => dumps(c, context));
  api.delete("/dumps/:name", (c) => deleteDump(c, context));
  api.get("/jobs/:id", (c) => job(c, context));
  api.post("/jobs/:id/cancel", (c) => cancelJob(c, context));
}

function dumpDownloadJob(c: Context, context: AppContext) {
  return c.json(startDumpDownload(context), 202);
}

function dumpUpdateJob(c: Context, context: AppContext) {
  return c.json(startDumpUpdate(context), 202);
}

async function dumpJob(c: Context, context: AppContext) {
  const body = await parseJson(c, DumpLoadJobInputSchema);
  if (!body.ok) return body.response;
  const job = startDumpLoad(context, body.data);
  return c.json(job, 202);
}

async function importJob(c: Context, context: AppContext) {
  const kind = IMPORT_KINDS.find((kind) => kind === c.req.param("kind"));
  if (!kind)
    return badRequest(c, `Unknown import kind; expected one of ${IMPORT_KINDS.join(", ")}`);
  const body = await parseJson(c, ImportJobInputSchema);
  if (!body.ok) return body.response;
  const job = startImport(context, kind, body.data);
  return c.json(job, 202);
}

function dumps(c: Context, context: AppContext) {
  return c.json(dumpsResponse(context));
}

function deleteDump(c: Context, context: AppContext) {
  refuseWhileDumpJobRuns(context);
  const name = c.req.param("name") ?? "";
  if (!deleteDumpFile(context.paths.dumpsDir, name))
    return c.json({ error: "That file is not in the catalogue folder" } satisfies ApiError, 404);
  context.logger.info(`deleted ${name} from the dumps folder`);
  return c.json(dumpsResponse(context));
}

function dumpsResponse(context: AppContext): DumpsResponse {
  const directory = context.paths.dumpsDir;
  return { directory, files: listDumpFiles(directory) };
}

function jobs(c: Context, context: AppContext) {
  const body: JobsResponse = { jobs: context.jobs.list() };
  return c.json(body);
}

function job(c: Context, context: AppContext) {
  const job = context.jobs.get(c.req.param("id") ?? "");
  if (!job) return c.json({ error: "Job not found" } satisfies ApiError, 404);
  return c.json(job);
}

function cancelJob(c: Context, context: AppContext) {
  const id = c.req.param("id") ?? "";
  const cancelled = context.jobs.cancel(id);
  const job = context.jobs.get(id);
  if (!job) return c.json({ error: "Job not found" } satisfies ApiError, 404);
  return c.json({ cancelled, job });
}
