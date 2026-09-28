import { type Config } from "../shared/config.ts";
import type { Db } from "./db/db.ts";
import { type DiscogsClient } from "./discogs/client.ts";
import type { JobRunner } from "./jobs/runner.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";
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
