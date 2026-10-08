import { type MessagePort, Worker } from "node:worker_threads";
import type { JobProgress } from "../../shared/types.ts";
import { createLogger, type Logger, type LogLevel } from "../logger.ts";

export type WorkerMessage<Result = unknown, Progress = JobProgress> =
  | { type: "progress"; progress: Progress }
  | { type: "log"; line: WorkerLogLine }
  | { type: "done"; result: Result }
  | { type: "error"; message: string };

/** A line a worker logs, which the thread that started it writes to its own log. */
export interface WorkerLogLine {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

/** The part of a job a worker reports to and stops with. */
export interface WorkerJob<Progress> {
  signal: AbortSignal;
  onProgress: (progress: Progress) => void;
}

export interface WorkerRun<Progress> {
  /** Must be serialisable. */
  workerData: unknown;
  job: WorkerJob<Progress>;
  /** Writes the lines the worker logs through workerLogger(). */
  logger: Logger;
}

type Outcome<Result> = { ok: true; result: Result } | { ok: false; error: Error };

/**
 * Runs a worker script that posts WorkerMessage objects, as one step of a job: progress goes to
 * the job, log lines to the logger, the job's signal terminates the worker, and the promise
 * settles once the worker has exited, so nothing uses the database after it.
 */
export function runWorker<Result, Progress = JobProgress>(
  script: URL,
  run: WorkerRun<Progress>,
): Promise<Result> {
  const { signal, onProgress } = run.job;
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, { workerData: run.workerData });
    let outcome: Outcome<Result> | null = null;
    const terminate = () => void worker.terminate();
    signal.addEventListener("abort", terminate, { once: true });

    worker.on("message", (message: WorkerMessage<Result, Progress>) => {
      if (message.type === "progress") onProgress(message.progress);
      if (message.type === "log") writeWorkerLine(run.logger, message.line);
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

/**
 * The logger a worker logs with: each line goes to the thread that started it, whose logger
 * applies its level and writes it to its log, since a packaged app loses a worker's console.
 * Logged data must survive postMessage, as errors and plain objects do.
 */
export function workerLogger(port: MessagePort, scope: string): Logger {
  return createLogger({
    level: "debug",
    scope,
    sink: {
      write(level, lineScope, message, data) {
        const line: WorkerLogLine = { level, scope: lineScope, message, data };
        port.postMessage({ type: "log", line } satisfies WorkerMessage);
      },
    },
  });
}

function writeWorkerLine(logger: Logger, line: WorkerLogLine): void {
  logger.child(line.scope)[line.level](line.message, line.data);
}
