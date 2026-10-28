import { type Context, Hono } from "hono";
import { type BackupSummary, type BackupsResponse, EXPORT_FILES } from "../../shared/api.ts";
import { type BackupFile, BACKUPS_KEPT, localDay, listBackups, writeBackup } from "../db/backup.ts";
import {
  backUpDecisionsInWorker,
  CHECKPOINTS_KEPT,
  DECISIONS_BACKUPS_KEPT,
  listCheckpoints,
  listDecisionsBackups,
} from "../decisions-backup.ts";
import { buildExport } from "../export.ts";
import type { AppContext } from "../context.ts";
import { badRequest } from "./request.ts";

/** The user's own data: the daily database copies and exports of every decision. */
export function registerDataRoutes(api: Hono, context: AppContext): void {
  api.get("/backups", (c) => backups(c, context));
  api.post("/backups", (c) => backUpNow(c, context));
  api.get("/export/:file", (c) => exportFile(c, context));
}

/**
 * Writes the day's decisions backup, a checkpoint and the database copy, replacing today's; once
 * all three are written, a scheduled backup's failure is over.
 */
async function backUpNow(c: Context, context: AppContext) {
  const now = new Date();
  const options = {
    dir: context.paths.backupsDir,
    day: localDay(now),
    now,
    config: context.getConfig(),
  };
  const { db, paths, logger } = context;
  await backUpDecisionsInWorker(db, paths.dbFile, { backup: "now", options }, logger);
  await backUpDecisionsInWorker(db, paths.dbFile, { backup: "checkpoint", options }, logger);
  await writeBackup(db, options);
  context.backedUpNow();
  return backups(c, context);
}

function backups(c: Context, context: AppContext) {
  const directory = context.paths.backupsDir;
  const body: BackupsResponse = {
    directory,
    kept: BACKUPS_KEPT,
    backups: listBackups(directory).map(summarize),
    checkpoints: { kept: CHECKPOINTS_KEPT, backups: listCheckpoints(directory).map(summarize) },
    decisions: {
      kept: DECISIONS_BACKUPS_KEPT,
      backups: listDecisionsBackups(directory).map(summarize),
    },
    failure: context.backupFailure(),
  };
  return c.json(body);
}

function exportFile(c: Context, context: AppContext) {
  const file = EXPORT_FILES.find((name) => name === c.req.param("file"));
  if (!file) return badRequest(c, `Unknown export; expected one of ${EXPORT_FILES.join(", ")}`);
  const now = new Date();
  const document = buildExport(context.db, file, now);
  return c.body(document.body, 200, {
    "content-type": document.contentType,
    "content-disposition": `attachment; filename="digga-${localDay(now)}-${file}"`,
  });
}

function summarize(backup: BackupFile): BackupSummary {
  return { day: backup.day, bytes: backup.bytes };
}
