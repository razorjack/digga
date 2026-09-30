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
import { badRequest, parseJson, refuseInSandbox } from "./request.ts";

export function registerJobsRoutes(api: Hono, context: AppContext): void {
  api.post("/jobs/dump-download", (request) => dumpDownloadJob(request, context));
  api.post("/jobs/dump-load", (request) => dumpJob(request, context));
  api.post("/jobs/dump-update", (request) => dumpUpdateJob(request, context));
  api.post("/jobs/import/:kind", (request) => importJob(request, context));
  api.get("/jobs", (request) => jobs(request, context));
  api.get("/dumps", (request) => dumps(request, context));
  api.delete("/dumps/:name", (request) => deleteDump(request, context));
  api.get("/jobs/:id", (request) => job(request, context));
  api.post("/jobs/:id/cancel", (request) => cancelJob(request, context));
}

function dumpDownloadJob(request: Context, context: AppContext) {
  return request.json(startDumpDownload(context), 202);
}

function dumpUpdateJob(request: Context, context: AppContext) {
  return request.json(startDumpUpdate(context), 202);
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

function dumps(request: Context, context: AppContext) {
  return request.json(dumpsResponse(context));
}

/** Setup rather than digging, so the sandbox does not refuse it. */
function deleteDump(request: Context, context: AppContext) {
  refuseWhileDumpJobRuns(context);
  const name = request.req.param("name") ?? "";
  if (!deleteDumpFile(context.paths.dumpsDir, name))
    return request.json({ error: "The dumps folder has no such dump" } satisfies ApiError, 404);
  context.logger.info(`deleted ${name} from the dumps folder`);
  return request.json(dumpsResponse(context));
}

function dumpsResponse(context: AppContext): DumpsResponse {
  const directory = context.paths.dumpsDir;
  return { directory, files: listDumpFiles(directory) };
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
