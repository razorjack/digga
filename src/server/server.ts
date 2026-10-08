import { HttpListener } from "./http.ts";
import type { Hono } from "hono";
import type { Config } from "../shared/config.ts";
import { createApp } from "./app.ts";
import { saveConfig } from "./config-file.ts";
import type { AppContext } from "./context.ts";
import { type DailyBackups, startDailyBackups } from "./daily-backups.ts";
import { type Db, openDb } from "./db/db.ts";
import { type Desktop, desktopJobListener } from "./desktop.ts";
import { failStaleJobs } from "./db/jobs.ts";
import { createDiscogsClient, type DiscogsClient } from "./discogs/client.ts";
import { createDataDumpClient } from "./discogs/data-dumps.ts";
import { createJobRunner, type JobRunner } from "./jobs/runner.ts";
import { type LibraryLock, lockLibrary } from "./library-lock.ts";
import type { Logger } from "./logger.ts";
import { type Paths, saveChosenDumpsDir } from "./paths.ts";
import type { Secrets } from "./secrets.ts";
import { createVideoTitleLookup } from "./youtube.ts";

export interface CreateServerOptions {
  config: Config;
  paths: Paths;
  secrets: Secrets;
  logger: Logger;
  /** Injected database (tests). When omitted the server opens paths.dbFile. */
  db?: Db;
  /** What the library lock calls this process, for another process's refusal; "the Digga server" by default. */
  libraryHolder?: string;
  /** The Digga app's main process, which hears every job change; the CLI's server has none. */
  desktop?: Desktop;
  /** Serve dist/ for non-API routes. Default true. */
  serveStatic?: boolean;
  /** Persist PUT /api/settings to paths.configFile. Default true. */
  persistConfig?: boolean;
  fetchImpl?: typeof fetch;
  /** Where the monthly dumps are listed; data.discogs.com unless a rehearsal points elsewhere. */
  dataDumpsUrl?: string;
  /** The Discogs API; api.discogs.com unless a stand-in replaces it (tests, rehearsals). */
  discogsApiUrl?: string;
  /** YouTube's oEmbed endpoint for pasted links; www.youtube.com unless a stand-in replaces it. */
  youtubeOembedUrl?: string;
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
 * The whole backend as a function. The CLI's `serve` command calls it, and so does the Electron
 * app's main process, which opens a BrowserWindow at the returned URL and gives it a desktop.
 */
export function createServer(options: CreateServerOptions): DiggaServer {
  let config = options.config;
  const ownsDb = options.db === undefined;
  const { db, lock } = openLibrary(options);
  const logger = options.logger;
  const stale = failStaleJobs(db);
  if (stale > 0) logger.warn(`marked ${stale} interrupted job(s) as failed`);
  const backups = lock ? startDailyBackups(db, { ...options, getConfig: () => config }) : null;
  const jobs = createJobRunner(db, logger.child("jobs"), desktopJobListener(options.desktop));

  const context: AppContext = {
    db,
    paths: options.paths,
    secrets: options.secrets,
    logger,
    jobs,
    getConfig: () => config,
    setConfig: (next) => {
      if (options.persistConfig !== false) saveConfig(options.paths.configFile, next);
      config = next;
      logger.info(`settings updated (${options.paths.configFile})`);
    },
    ...serviceClients(options),
    desktop: options.desktop ?? null,
    serveStatic: options.serveStatic ?? true,
    backupFailure: () => backups?.failure() ?? null,
    backedUpNow: () => backups?.backedUp(),
    useChosenDumpsDir: (folder) => {
      context.paths = saveChosenDumpsDir(context.paths, folder);
      logger.info(`dumps folder chosen: ${folder}`);
    },
  };
  const app = createApp(context);

  const listener = new HttpListener(app, logger);
  let stopping: Promise<void> | null = null;
  return {
    app,
    db,
    jobs,
    getConfig: () => config,
    start: (port, host) => listener.start(port ?? config.server.port, host ?? config.server.host),
    stop: () => (stopping ??= stopServer({ listener, jobs, backups, db, ownsDb, lock, logger })),
  };
}

/**
 * The injected database, or the library's, opened once this process holds the library: a
 * second server would otherwise fail the first one's running jobs and write the same backups.
 */
function openLibrary(options: CreateServerOptions): { db: Db; lock: LibraryLock | null } {
  if (options.db) return { db: options.db, lock: null };
  if (options.paths.dbFile === ":memory:") return { db: openDb(":memory:"), lock: null };
  const lock = lockLibrary(options.paths.lockFile, options.libraryHolder ?? "the Digga server");
  try {
    return { db: openDb(options.paths.dbFile), lock };
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** The clients of the services Digga reads: Discogs, data.discogs.com and YouTube's oEmbed. */
function serviceClients(
  options: CreateServerOptions,
): Pick<AppContext, "getDiscogs" | "dataDumps" | "lookupVideoTitle"> {
  return {
    getDiscogs: discogsProvider(options),
    dataDumps: createDataDumpClient({
      fetchImpl: options.fetchImpl,
      baseUrl: options.dataDumpsUrl,
    }),
    lookupVideoTitle: createVideoTitleLookup({
      fetchImpl: options.fetchImpl,
      logger: options.logger.child("youtube"),
      baseUrl: options.youtubeOembedUrl,
    }),
  };
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
        baseUrl: options.discogsApiUrl,
        fetchImpl: options.fetchImpl,
        logger: logger.child("discogs"),
      });
      if (!token)
        logger.warn(
          "no Discogs token is set; Discogs requests will be unauthenticated and rate limited harder",
        );
    }
    return discogs;
  };

  return getDiscogs;
}

async function stopServer(context: {
  listener: HttpListener;
  jobs: JobRunner;
  backups: DailyBackups | null;
  db: Db;
  ownsDb: boolean;
  lock: LibraryLock | null;
  logger: Logger;
}): Promise<void> {
  await context.listener.stop();
  await context.jobs.stop();
  await context.backups?.stop();
  if (context.ownsDb) context.db.close();
  context.lock?.release();
  context.logger.info("stopped");
}
