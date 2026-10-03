import { parentPort, workerData } from "node:worker_threads";
import type { BackupFile } from "./db/backup.ts";
import { openDb } from "./db/db.ts";
import { type DecisionsBackupTask, runDecisionsBackupTask } from "./decisions-backup.ts";
import type { WorkerMessage } from "./jobs/worker.ts";

const data = workerData as DecisionsBackupTask & { dbFile: string };
const port = parentPort;
if (!port) throw new Error("decisions-backup-worker must run inside a Worker");

const post = (message: WorkerMessage<BackupFile | null, never>) => port.postMessage(message);
const db = openDb(data.dbFile);

try {
  post({ type: "done", result: await runDecisionsBackupTask(db, data) });
} catch (error) {
  post({ type: "error", message: error instanceof Error ? error.message : String(error) });
} finally {
  db.close();
}
