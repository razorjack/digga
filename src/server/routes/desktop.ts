import path from "node:path";
import { type Context, Hono } from "hono";
import type { ApiError, DumpFileResponse, DumpsFolderResponse } from "../../shared/api.ts";
import type { AppContext } from "../context.ts";
import type { Desktop } from "../desktop.ts";
import { canHoldDumps, isDumpFileElsewhere } from "../dump-files.ts";
import { refuseWhileDumpJobRuns } from "../jobs/start.ts";

/**
 * The desktop app's native dialogs (decision 168). Only the app's server has them; the CLI's
 * answers these paths as unknown routes, and the setup offers them only where GET /api/setup
 * reports a desktop.
 */
export function registerDesktopRoutes(api: Hono, context: AppContext): void {
  const desktop = context.desktop;
  if (!desktop) return;
  api.post("/desktop/dump-file", (request) => chooseDumpFile(request, context, desktop));
  api.post("/desktop/dumps-folder", (request) => chooseDumpsFolder(request, context, desktop));
}

async function chooseDumpFile(request: Context, context: AppContext, desktop: Desktop) {
  const file = await desktop.chooseDumpFile();
  if (file !== null && !isDumpFileElsewhere(file))
    return request.json(
      {
        error: `${path.basename(file)} is not a releases dump; pick a file ending in .xml.gz`,
      } satisfies ApiError,
      400,
    );
  if (file !== null) context.logger.info(`the setup reads the dump file the user chose: ${file}`);
  return request.json({ file } satisfies DumpFileResponse);
}

/**
 * Another folder for the dumps, which later launches keep (paths.ts). DIGGA_DUMPS_DIR would
 * override it, and a download or load writes or reads the folder it started with.
 */
async function chooseDumpsFolder(request: Context, context: AppContext, desktop: Desktop) {
  if (context.paths.dumpsDirSource === "environment")
    return request.json(
      { error: "DIGGA_DUMPS_DIR names the dumps folder; change it there" } satisfies ApiError,
      409,
    );
  refuseWhileDumpJobRuns(context);
  const folder = await desktop.chooseDumpsFolder(context.paths.dumpsDir);
  if (folder === null) return request.json({ folder } satisfies DumpsFolderResponse);
  if (!canHoldDumps(folder))
    return request.json({ error: `Digga cannot write to ${folder}` } satisfies ApiError, 400);
  // One may have started while the dialog was open.
  refuseWhileDumpJobRuns(context);
  context.useChosenDumpsDir(folder);
  return request.json({ folder } satisfies DumpsFolderResponse);
}
