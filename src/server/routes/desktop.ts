import path from "node:path";
import { type Context, Hono } from "hono";
import type { ApiError, DumpFileResponse } from "../../shared/api.ts";
import type { AppContext } from "../context.ts";
import type { Desktop } from "../desktop.ts";
import { isDumpFileElsewhere } from "../dump-files.ts";

/**
 * The desktop app's native dialogs (decision 168). Only the app's server has them; the CLI's
 * answers these paths as unknown routes, and the setup offers them only where GET /api/setup
 * reports a desktop.
 */
export function registerDesktopRoutes(api: Hono, context: AppContext): void {
  const desktop = context.desktop;
  if (!desktop) return;
  api.post("/desktop/dump-file", (request) => chooseDumpFile(request, context, desktop));
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
