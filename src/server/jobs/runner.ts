import { Worker } from "node:worker_threads";
import type { Job, JobType, JobProgress } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import {
  createJob,
  getJob,
  listJobs,
  markJobFinished,
  markJobStarted,
  updateJobProgress,
} from "../db/jobs.ts";
import type { Logger } from "../logger.ts";

export interface JobContext {
  signal: AbortSignal;
  onProgress: (progress: JobProgress) => void;
}

export type JobFn<Result = unknown> = (context: JobContext) => Promise<Result>;

export type WorkerMessage =
  | { type: "progress"; progress: JobProgress }
  | { type: "done"; result: unknown }
  | { type: "error"; message: string };

export interface JobRunner {
  /** Runs an async job function on this thread (fine for network-bound work). Returns immediately. */
  run(type: JobType, fn: JobFn): Job;
  /** Runs a worker script that posts WorkerMessage objects. workerData must be serialisable. */
  runInWorker(type: JobType, script: URL, workerData: unknown): Job;
  /** Runs a job function and waits for it (CLI). */
  runAndWait<Result>(type: JobType, fn: JobFn<Result>): Promise<{ job: Job; result: Result }>;
  cancel(id: string): boolean;
  get(id: string): Job | null;
  list(limit?: number): Job[];
  active(): string[];
}

export function createJobRunner(db: Db, logger: Logger): JobRunner {
  const controllers = new Map<string, { abort: () => void }>();

  const finish = (id: string, status: "done" | "failed" | "cancelled", error?: string) => {
    markJobFinished(db, id, status, error);
    controllers.delete(id);
  };

  const execute = async <Result>(job: Job, fn: JobFn<Result>): Promise<Result> => {
    const controller = new AbortController();
    controllers.set(job.id, { abort: () => controller.abort() });
    markJobStarted(db, job.id);
    const log = logger.child(job.type);
    try {
      const result = await fn({
        signal: controller.signal,
        onProgress: (progress) => updateJobProgress(db, job.id, progress),
      });
      finish(job.id, controller.signal.aborted ? "cancelled" : "done");
      log.info(`job ${job.id} ${controller.signal.aborted ? "cancelled" : "done"}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish(job.id, controller.signal.aborted ? "cancelled" : "failed", message);
      log.error(`job ${job.id} failed: ${message}`);
      throw err;
    }
  };

  return {
    run(type, fn) {
      const job = createJob(db, type);
      void execute(job, fn).catch(() => {});
      return job;
    },
    async runAndWait(type, fn) {
      const job = createJob(db, type);
      const result = await execute(job, fn);
      return { job: getJob(db, job.id)!, result };
    },
    runInWorker(type, script, workerData) {
      const job = createJob(db, type);
      markJobStarted(db, job.id);
      const worker = new Worker(script, { workerData });
      controllers.set(job.id, { abort: () => void worker.terminate() });
      worker.on("message", (msg: WorkerMessage) => {
        if (msg.type === "progress") updateJobProgress(db, job.id, msg.progress);
        else if (msg.type === "done") {
          finish(job.id, "done");
        } else if (msg.type === "error") finish(job.id, "failed", msg.message);
      });
      worker.on("error", (err) => finish(job.id, "failed", err.message));
      worker.on("exit", (code) => {
        const current = getJob(db, job.id);
        if (current && current.status === "running")
          finish(job.id, code === 0 ? "done" : "cancelled");
      });
      return job;
    },
    cancel(id) {
      const c = controllers.get(id);
      if (!c) return false;
      c.abort();
      return true;
    },
    get: (id) => getJob(db, id),
    list: (limit) => listJobs(db, limit),
    active: () => [...controllers.keys()],
  };
}
