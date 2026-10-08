import { type Config } from "../shared/config.ts";
import type { BackupFailure } from "../shared/api.ts";
import type { Db } from "./db/db.ts";
import type { Desktop } from "./desktop.ts";
import { type DiscogsClient } from "./discogs/client.ts";
import type { DataDumpClient } from "./discogs/data-dumps.ts";
import type { JobRunner } from "./jobs/runner.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";
import type { Secrets } from "./secrets.ts";
import type { VideoTitleLookup } from "./youtube.ts";
export interface AppContext {
  db: Db;
  paths: Paths;
  secrets: Secrets;
  logger: Logger;
  jobs: JobRunner;
  getConfig(): Config;
  setConfig(config: Config): void;
  getDiscogs(): DiscogsClient;
  /** The monthly dumps on data.discogs.com. */
  dataDumps: DataDumpClient;
  /** YouTube's title for a video, used to match a pasted link to a track. */
  lookupVideoTitle: VideoTitleLookup;
  /** The Digga app's main process, with its native dialogs; null in the CLI's server. */
  desktop: Desktop | null;
  /** Serve dist/ for non-API routes (production). */
  serveStatic: boolean;
  /** The latest scheduled backup that failed, until a later one succeeds. */
  backupFailure(): BackupFailure | null;
}
