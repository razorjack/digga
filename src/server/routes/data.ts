import { type Context, Hono } from "hono";
import { type BackupSummary, type BackupsResponse, EXPORT_FILES } from "../../shared/api.ts";
import { type BackupFile, BACKUPS_KEPT, localDay, listBackups, writeBackup } from "../db/backup.ts";
import {
  CHECKPOINTS_KEPT,
  checkpointDecisions,
  DECISIONS_BACKUPS_KEPT,
  listCheckpoints,
  listDecisionsBackups,
  writeDecisionsBackup,
} from "../decisions-backup.ts";
import { buildExport } from "../export.ts";
import type { AppContext } from "../context.ts";
import { badRequest } from "./request.ts";

/** The user's own data: the daily database copies and exports of every decision. */
export function registerDataRoutes(api: Hono, context: AppContext): void {
  api.get("/backups", (request) => backups(request, context));
  api.post("/backups", (request) => backUpNow(request, context));
  api.get("/export/:file", (request) => exportFile(request, context));
}

/** Writes the day's decisions backup, a checkpoint and the database copy, replacing today's. */
async function backUpNow(request: Context, context: AppContext) {
  const now = new Date();
  const options = {
    dir: context.paths.backupsDir,
    day: localDay(now),
    now,
    config: context.getConfig(),
  };
  await writeDecisionsBackup(context.db, options);
  await checkpointDecisions(context.db, options);
  await writeBackup(context.db, options);
  return backups(request, context);
}

function backups(request: Context, context: AppContext) {
  const directory = context.paths.backupsDir;
  const body: BackupsResponse = {
    directory,
    databaseFile: context.paths.dbFile,
    kept: BACKUPS_KEPT,
    backups: listBackups(directory).map(summarize),
    checkpoints: { kept: CHECKPOINTS_KEPT, backups: listCheckpoints(directory).map(summarize) },
    decisions: {
      kept: DECISIONS_BACKUPS_KEPT,
      backups: listDecisionsBackups(directory).map(summarize),
    },
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

function summarize(backup: BackupFile): BackupSummary {
  return { day: backup.day, bytes: backup.bytes };
}
