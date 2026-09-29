import { parentPort, workerData } from "node:worker_threads";
import type { DumpLoadResult } from "../../../tools/dump/load.ts";
import type { DumpLoadProgress } from "../../shared/types.ts";
import { openDb } from "../db/db.ts";
import { createLogger } from "../logger.ts";
import { dumpLoad, type DumpLoadJobOptions } from "./dump-load.ts";
import type { WorkerMessage } from "./worker.ts";

export interface DumpLoadWorkerData {
  dbFile: string;
  options: DumpLoadJobOptions;
}

const data = workerData as DumpLoadWorkerData;
const port = parentPort;
if (!port) throw new Error("dump-load-worker must run inside a Worker");

const post = (message: WorkerMessage<DumpLoadResult, DumpLoadProgress>) =>
  port.postMessage(message);
const db = openDb(data.dbFile);
const logger = createLogger({ scope: "dump-load-worker" });

try {
  const result = await dumpLoad({ db, logger }, data.options, (progress) =>
    post({ type: "progress", progress }),
  );
  post({ type: "done", result });
} catch (error) {
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
} finally {
  db.close();
}
