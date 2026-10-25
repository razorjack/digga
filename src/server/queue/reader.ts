import { Worker } from "node:worker_threads";
import type { QueueItem, Stats } from "../../shared/api.ts";
import type { Config } from "../../shared/config.ts";
import type { ScopeRef } from "../../shared/scope.ts";
import type { Db } from "../db/db.ts";
import { computeStats } from "../stats.ts";
import { countRemaining, type QueueParams, queryQueue } from "./query.ts";

/**
 * The reads that scan the universe: the queue and the stats. In a server with a library file
 * they run in a worker with its own connection, so a scan that computes again after a load or a
 * new want never holds up the server's thread, which in the Digga app is the window's too.
 */
export interface QueueReader {
  queue(query: QueueParams): Promise<QueuePage>;
  stats(config: Config, scope: ScopeRef | null): Promise<Stats>;
  close(): Promise<void>;
}

export interface QueuePage {
  items: QueueItem[];
  /** The records left in the query's filters and scope. */
  remaining: number;
}

export type ReaderRequest =
  | { kind: "queue"; query: QueueParams }
  | { kind: "stats"; config: Config; scope: ScopeRef | null };

/** A request with the catalogue's version, which the worker keeps its results under. */
export interface ReaderMessage {
  id: number;
  version: string;
  request: ReaderRequest;
}

export type ReaderReply =
  | { id: number; ok: true; result: QueuePage | Stats }
  | { id: number; ok: false; message: string };

export function answerReaderRequest(db: Db, request: ReaderRequest): QueuePage | Stats {
  switch (request.kind) {
    case "queue":
      return {
        items: queryQueue(db, request.query),
        remaining: countRemaining(db, request.query.filters, request.query.scope ?? null),
      };
    case "stats":
      return computeStats(db, request.config, request.scope);
  }
}

/** For a database a worker cannot open, in memory or injected by a test. */
export function inlineQueueReader(db: Db): QueueReader {
  return {
    queue: async (query) => answerReaderRequest(db, { kind: "queue", query }) as QueuePage,
    stats: async (config, scope) =>
      answerReaderRequest(db, { kind: "stats", config, scope }) as Stats,
    close: async () => {},
  };
}

const READER_WORKER = new URL("./reader-worker.ts", import.meta.url);

/**
 * Starts the worker at the first read, and again after one stopped. `version` is the catalogue's
 * version on the connection that writes.
 */
export function workerQueueReader(dbFile: string, version: () => string): QueueReader {
  let current: ReaderWorker | null = null;
  const ask = (request: ReaderRequest) => {
    if (!current?.running) current = new ReaderWorker(dbFile);
    return current.ask(version(), request);
  };
  return {
    // The worker answers a request with what answerReaderRequest() returns for its kind.
    queue: (query) => ask({ kind: "queue", query }) as Promise<QueuePage>,
    stats: (config, scope) => ask({ kind: "stats", config, scope }) as Promise<Stats>,
    async close() {
      const stopping = current;
      current = null;
      await stopping?.terminate();
    },
  };
}

/** One worker and the reads waiting for it, which fail when it stops. */
class ReaderWorker {
  running = true;
  #worker: Worker;
  #pending = new Map<number, PromiseWithResolvers<QueuePage | Stats>>();
  #lastId = 0;

  constructor(dbFile: string) {
    this.#worker = new Worker(READER_WORKER, { workerData: { dbFile } });
    // An idle reader never keeps the process alive; the server's listener does.
    this.#worker.unref();
    this.#worker.on("message", (reply: ReaderReply) => this.#answer(reply));
    this.#worker.on("error", (error) => this.#failPending(error));
    this.#worker.on("exit", (code) => {
      this.running = false;
      this.#failPending(new Error(`The queue reader stopped with code ${code}`));
    });
  }

  ask(version: string, request: ReaderRequest): Promise<QueuePage | Stats> {
    this.#lastId += 1;
    const reply = Promise.withResolvers<QueuePage | Stats>();
    this.#pending.set(this.#lastId, reply);
    const message: ReaderMessage = { id: this.#lastId, version, request };
    this.#worker.postMessage(message);
    return reply.promise;
  }

  async terminate(): Promise<void> {
    this.running = false;
    await this.#worker.terminate();
  }

  #answer(reply: ReaderReply): void {
    const waiting = this.#pending.get(reply.id);
    this.#pending.delete(reply.id);
    if (reply.ok) waiting?.resolve(reply.result);
    else waiting?.reject(new Error(reply.message));
  }

  #failPending(error: Error): void {
    for (const waiting of this.#pending.values()) waiting.reject(error);
    this.#pending.clear();
  }
}
