import { Worker } from "node:worker_threads";
import type { JobProgress } from "../../shared/types.ts";

export type WorkerMessage<Result = unknown, Progress = JobProgress> =
  | { type: "progress"; progress: Progress }
  | { type: "done"; result: Result }
  | { type: "error"; message: string };

/** The part of a job a worker reports to and stops with. */
export interface WorkerJob<Progress> {
  signal: AbortSignal;
  onProgress: (progress: Progress) => void;
}

type Outcome<Result> = { ok: true; result: Result } | { ok: false; error: Error };

/**
 * Runs a worker script that posts WorkerMessage objects, as one step of a job: progress goes to
 * the job, the job's signal terminates the worker, and the promise settles once the worker has
 * exited, so nothing uses the database after it. workerData must be serialisable.
 */
export function runWorker<Result, Progress = JobProgress>(
  script: URL,
  workerData: unknown,
  job: WorkerJob<Progress>,
): Promise<Result> {
  const { signal, onProgress } = job;
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, { workerData });
    let outcome: Outcome<Result> | null = null;
    const terminate = () => void worker.terminate();
    signal.addEventListener("abort", terminate, { once: true });

    worker.on("message", (message: WorkerMessage<Result, Progress>) => {
      if (message.type === "progress") onProgress(message.progress);
      if (message.type === "done") outcome = { ok: true, result: message.result };
      if (message.type === "error") outcome = { ok: false, error: new Error(message.message) };
    });
    worker.on("error", (error) => {
      outcome ??= { ok: false, error };
    });
    worker.on("exit", (code) => {
      signal.removeEventListener("abort", terminate);
      if (outcome?.ok) resolve(outcome.result);
      else if (outcome) reject(outcome.error);
      else if (signal.aborted) reject(new Error("Cancelled"));
      else reject(new Error(`Worker exited with code ${code}`));
    });
  });
}
