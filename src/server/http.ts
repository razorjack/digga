import type { Server as HttpServer } from "node:http";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { LOOPBACK_HOSTS } from "../shared/config.ts";
import type { Logger } from "./logger.ts";

export interface StartInfo {
  host: string;
  port: number;
  url: string;
  /** YouTube refuses some embeds on IP-address origins, so browsers use localhost. */
  browserUrl: string;
}
const LOOPBACK = new Set(["127.0.0.1", "::1"]);
const LISTEN_HOSTS: ReadonlySet<string> = new Set(LOOPBACK_HOSTS);

export class HttpListener {
  #app: Hono;
  #logger: Logger;
  #server: ServerType | null = null;

  constructor(app: Hono, logger: Logger) {
    this.#app = app;
    this.#logger = logger;
  }

  start(port: number, hostname: string): Promise<StartInfo> {
    if (this.#server) return Promise.reject(new Error("Server is already started"));
    if (!LISTEN_HOSTS.has(hostname))
      return Promise.reject(
        new Error(`Digga listens on this computer only; ${hostname} is not a loopback address`),
      );
    return new Promise((resolve, reject) => {
      const server = serve({ fetch: this.#app.fetch, port, hostname }, (info) => {
        const start = startInfo(info.address, info.port);
        this.#logger.info(`listening on ${start.url}`);
        resolve(start);
      });
      server.on("error", reject);
      this.#server = server;
    });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    (server as HttpServer).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function startInfo(host: string, port: number): StartInfo {
  const address = host.includes(":") ? `[${host}]` : host;
  const url = `http://${address}:${port}`;
  const browserUrl = LOOPBACK.has(host) ? `http://localhost:${port}` : url;
  return { host, port, url, browserUrl };
}
