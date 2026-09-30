import { type Context, Hono } from "hono";
import { type BackupsResponse, EXPORT_FILES } from "../../shared/api.ts";
import { BACKUPS_KEPT, localDay, listBackups } from "../db/backup.ts";
import { buildExport } from "../export.ts";
import type { AppContext } from "../context.ts";
import { badRequest } from "./request.ts";

/** The user's own data: the daily database copies and exports of every decision. */
export function registerDataRoutes(api: Hono, context: AppContext): void {
  api.get("/backups", (request) => backups(request, context));
  api.get("/export/:file", (request) => exportFile(request, context));
}

function backups(request: Context, context: AppContext) {
  const directory = context.paths.backupsDir;
  const body: BackupsResponse = {
    directory,
    databaseFile: context.paths.dbFile,
    kept: BACKUPS_KEPT,
    backups: listBackups(directory).map((backup) => ({ day: backup.day, bytes: backup.bytes })),
  };
  return request.json(body);
}

function exportFile(request: Context, context: AppContext) {
  const file = EXPORT_FILES.find((name) => name === request.req.param("file"));
  if (!file)
    return badRequest(request, `Unknown export; expected one of ${EXPORT_FILES.join(", ")}`);
  const now = new Date();
  const document = buildExport(context.db, file, now);
  return request.body(document.body, 200, {
    "content-type": document.contentType,
    "content-disposition": `attachment; filename="digga-${localDay(now)}-${file}"`,
  });
}
