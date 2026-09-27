import { parentPort, workerData } from "node:worker_threads";
import type { DumpLoadOptions } from "../../../tools/dump/load.ts";
import { openDb } from "../db/db.ts";
import { createLogger } from "../logger.ts";
import { dumpLoad } from "./dump-load.ts";
import type { WorkerMessage } from "./runner.ts";

export interface DumpLoadWorkerData {
  dbFile: string;
  options: DumpLoadOptions;
}

const data = workerData as DumpLoadWorkerData;
const port = parentPort;
if (!port) throw new Error("dump-load-worker must run inside a Worker");

const post = (msg: WorkerMessage) => port.postMessage(msg);
const db = openDb(data.dbFile);
const logger = createLogger({ scope: "dump-load-worker" });

try {
  const result = await dumpLoad({ db, logger }, data.options, (progress) =>
    post({ type: "progress", progress }),
  );
  post({ type: "done", result });
} catch (err) {
  post({ type: "error", message: err instanceof Error ? err.message : String(err) });
} finally {
  db.close();
}
