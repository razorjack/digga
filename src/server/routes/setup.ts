import { type Context, Hono } from "hono";
import type { ApiError } from "../../shared/api.ts";
import type { AppContext } from "../context.ts";
import { forgetUnfinishedLoads, hasLoadedCatalogue } from "../db/dump-loads.ts";
import { refuseWhileDumpJobRuns } from "../jobs/start.ts";
import { readSetup } from "../setup.ts";
import { readStyleCensus } from "../style-census.ts";

/** The first run: what it needs to know, and the style census for its style picker. */
export function registerSetupRoutes(api: Hono, context: AppContext): void {
  api.get("/setup", (c) => setup(c, context));
  api.get("/styles", (c) => c.json(readStyleCensus(context.db)));
  api.delete("/setup/load", (c) => forgetFirstLoad(c, context));
}

/** "Change your picks" during the first load: the releases it added go, so new picks start clean. */
function forgetFirstLoad(c: Context, context: AppContext) {
  if (hasLoadedCatalogue(context.db))
    return c.json(
      {
        error: "The catalogue is already loaded. Change the styles in Settings › Library",
      } satisfies ApiError,
      409,
    );
  refuseWhileDumpJobRuns(context, downloadJobId(context));
  const deleted = forgetUnfinishedLoads(context.db);
  context.logger.info(`forgot the unfinished first load: ${deleted} releases deleted`);
  return c.json({ deleted });
}

/** The download may go on while the picks change. */
function downloadJobId(context: AppContext): string | undefined {
  return context.jobs.list().find((job) => job.type === "dump_download" && job.status === "running")
    ?.id;
}

async function setup(c: Context, context: AppContext) {
  return c.json(await readSetup(context));
}
