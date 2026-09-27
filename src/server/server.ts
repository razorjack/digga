import type { Server as HttpServer } from "node:http";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import type { Config } from "../shared/config.ts";
import { createApp } from "./app.ts";
import { saveConfig } from "./config-file.ts";
import { type Db, openDb } from "./db/db.ts";
import { failStaleJobs } from "./db/jobs.ts";
import { createDiscogsClient, type DiscogsClient } from "./discogs/client.ts";
import { createJobRunner, type JobRunner } from "./jobs/runner.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";
import type { Secrets } from "./secrets.ts";

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

export interface StartInfo {
  host: string;
  port: number;
  url: string;
  /**
   * The URL to open the app at. YouTube refuses some embeds (error 150) on IP-address origins
   * such as 127.0.0.1, so a loopback server is opened as localhost.
   */
  browserUrl: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1"]);

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
export function createServer(opts: CreateServerOptions): DiggaServer {
  let config = opts.config;
  const ownsDb = opts.db === undefined;
  const db = opts.db ?? openDb(opts.paths.dbFile);
  const logger = opts.logger;
  const stale = failStaleJobs(db);
  if (stale > 0) logger.warn(`marked ${stale} interrupted job(s) as failed`);
  const jobs = createJobRunner(db, logger.child("jobs"));

  let discogs: DiscogsClient | null = null;
  let discogsToken: string | undefined;
  const getDiscogs = () => {
    const token = opts.secrets.getDiscogsToken();
    if (!discogs || token !== discogsToken) {
      discogsToken = token;
      discogs = createDiscogsClient({
        token,
        fetchImpl: opts.fetchImpl,
        logger: logger.child("discogs"),
      });
      if (!token)
        logger.warn(
          "DISCOGS_TOKEN is not set; Discogs requests will be unauthenticated and rate limited harder",
        );
    }
    return discogs;
  };

  const app = createApp({
    db,
    paths: opts.paths,
    logger,
    jobs,
    getConfig: () => config,
    setConfig: (next) => {
      config = next;
      if (opts.persistConfig !== false) saveConfig(opts.paths.configFile, next);
      logger.info(`settings updated (${opts.paths.configFile})`);
    },
    getDiscogs,
    serveStatic: opts.serveStatic ?? true,
  });

  let httpServer: ServerType | null = null;

  return {
    app,
    db,
    jobs,
    getConfig: () => config,
    start(port, host) {
      const hostname = host ?? config.server.host;
      const requested = port ?? config.server.port;
      return new Promise<StartInfo>((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port: requested, hostname }, (info) => {
          const url = `http://${info.address.includes(":") ? `[${info.address}]` : info.address}:${info.port}`;
          const browserUrl = LOOPBACK.has(info.address) ? `http://localhost:${info.port}` : url;
          logger.info(`listening on ${url}`);
          resolve({ host: info.address, port: info.port, url, browserUrl });
        });
        server.on("error", reject);
        httpServer = server;
      });
    },
    async stop() {
      const server = httpServer;
      httpServer = null;
      if (server) {
        (server as HttpServer).closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      for (const id of jobs.active()) jobs.cancel(id);
      if (ownsDb) db.close();
      logger.info("stopped");
    },
  };
}
