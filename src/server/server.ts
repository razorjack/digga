import { HttpListener } from "./http.ts";
import type { Hono } from "hono";
import type { Config } from "../shared/config.ts";
import { createApp } from "./app.ts";
import { saveConfig } from "./config-file.ts";
import { backupDaily, localDay } from "./db/backup.ts";
import { type Db, openDb } from "./db/db.ts";
import { failStaleJobs } from "./db/jobs.ts";
import { createDiscogsClient, type DiscogsClient } from "./discogs/client.ts";
import { createJobRunner, type JobRunner } from "./jobs/runner.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";
import type { Secrets } from "./secrets.ts";
import { createVideoTitleLookup } from "./youtube.ts";

export interface CreateServerOptions {
  config: Config;
  paths: Paths;
  secrets: Secrets;
  logger: Logger;
  /** Injected database (tests). When omitted the server opens paths.dbFile. */
  db?: Db;
  /** Serve dist/ for non-API routes. Default true. */
  serveStatic?: boolean;
  /** Persist PUT /api/settings to paths.configFile. Default true. */
  persistConfig?: boolean;
  fetchImpl?: typeof fetch;
}

import type { StartInfo } from "./http.ts";
export type { StartInfo } from "./http.ts";

export interface DiggaServer {
  app: Hono;
  db: Db;
  jobs: JobRunner;
  getConfig(): Config;
  start(port?: number, host?: string): Promise<StartInfo>;
  stop(): Promise<void>;
}

/**
 * The whole backend as a function. The CLI's `serve` command calls it; Electron's
 * main process will call it too and open a BrowserWindow at the returned URL.
 */
export function createServer(options: CreateServerOptions): DiggaServer {
  let config = options.config;
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(options.paths.dbFile);
  const logger = options.logger;
  const stale = failStaleJobs(db);
  if (stale > 0) logger.warn(`marked ${stale} interrupted job(s) as failed`);
  const backup = ownsDb ? startDailyBackup(db, options) : Promise.resolve();
  const jobs = createJobRunner(db, logger.child("jobs"));

  const app = createApp({
    db,
    paths: options.paths,
    logger,
    jobs,
    getConfig: () => config,
    setConfig: (next) => {
      if (options.persistConfig !== false) saveConfig(options.paths.configFile, next);
      config = next;
      logger.info(`settings updated (${options.paths.configFile})`);
    },
    getDiscogs: discogsProvider(options),
    lookupVideoTitle: createVideoTitleLookup(options.fetchImpl, logger.child("youtube")),
    serveStatic: options.serveStatic ?? true,
  });

  const listener = new HttpListener(app, logger);
  let stopping: Promise<void> | null = null;
  return {
    app,
    db,
    jobs,
    getConfig: () => config,
    start: (port, host) => listener.start(port ?? config.server.port, host ?? config.server.host),
    stop: () => (stopping ??= stopServer({ listener, jobs, backup, db, ownsDb, logger })),
  };
}

/** Copies the database once a day in the background; the copy reads a consistent snapshot. */
function startDailyBackup(db: Db, options: CreateServerOptions): Promise<void> {
  const { paths, logger } = options;
  if (paths.dbFile === ":memory:") return Promise.resolve();
  return backupDaily(db, { dir: paths.backupsDir, day: localDay(new Date()) })
    .then((backup) => {
      if (backup) logger.info(`backed up the database to ${backup.file}`);
    })
    .catch((error: unknown) => logger.warn("the daily database backup failed", error));
}

function discogsProvider(options: CreateServerOptions): () => DiscogsClient {
  const logger = options.logger;
  let discogs: DiscogsClient | null = null;
  let discogsToken: string | undefined;
  const getDiscogs = () => {
    const token = options.secrets.getDiscogsToken();
    if (!discogs || token !== discogsToken) {
      discogsToken = token;
      discogs = createDiscogsClient({
        token,
        fetchImpl: options.fetchImpl,
        logger: logger.child("discogs"),
      });
      if (!token)
        logger.warn(
          "DISCOGS_TOKEN is not set; Discogs requests will be unauthenticated and rate limited harder",
        );
    }
    return discogs;
  };

  return getDiscogs;
}

async function stopServer(context: {
  listener: HttpListener;
  jobs: JobRunner;
  backup: Promise<void>;
  db: Db;
  ownsDb: boolean;
  logger: Logger;
}): Promise<void> {
  await context.listener.stop();
  await context.jobs.stop();
  await context.backup;
  if (context.ownsDb) context.db.close();
  context.logger.info("stopped");
}
