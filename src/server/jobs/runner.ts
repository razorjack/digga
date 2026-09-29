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

export interface JobRunner {
  /**
   * Runs an async job function on this thread and returns at once. CPU-heavy steps run in a
   * worker through runWorker() in worker.ts.
   */
  run(type: JobType, fn: JobFn): Job;
  /** Runs a job function and waits for it (CLI). */
  runAndWait<Result>(type: JobType, fn: JobFn<Result>): Promise<{ job: Job; result: Result }>;
  cancel(id: string): boolean;
  get(id: string): Job | null;
  list(limit?: number): Job[];
  active(): string[];
  /** Cancels active work and waits until it no longer uses the database. */
  stop(): Promise<void>;
}

interface ActiveJob {
  abort(): void;
  finished: Promise<unknown>;
}

export function createJobRunner(db: Db, logger: Logger): JobRunner {
  return new Runner(db, logger);
}

class Runner implements JobRunner {
  #db: Db;
  #logger: Logger;
  #active = new Map<string, ActiveJob>();
  #stopping = false;

  constructor(db: Db, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  run(type: JobType, fn: JobFn): Job {
    const { job, result } = this.#startAsync(type, fn);
    void result.catch(() => {});
    return job;
  }

  async runAndWait<Result>(
    type: JobType,
    fn: JobFn<Result>,
  ): Promise<{ job: Job; result: Result }> {
    const started = this.#startAsync(type, fn);
    const result = await started.result;
    return { job: getJob(this.#db, started.job.id)!, result };
  }

  #create(type: JobType): Job {
    if (this.#stopping) throw new Error("Job runner is stopping");
    const job = createJob(this.#db, type);
    markJobStarted(this.#db, job.id);
    return job;
  }

  #startAsync<Result>(type: JobType, fn: JobFn<Result>): { job: Job; result: Promise<Result> } {
    const job = this.#create(type);
    const controller = new AbortController();
    const result = this.#execute(job, fn, controller).finally(() => this.#active.delete(job.id));
    this.#active.set(job.id, { abort: () => controller.abort(), finished: result });
    return { job, result };
  }

  async #execute<Result>(
    job: Job,
    fn: JobFn<Result>,
    controller: AbortController,
  ): Promise<Result> {
    const log = this.#logger.child(job.type);
    try {
      const result = await fn({
        signal: controller.signal,
        onProgress: (progress) => updateJobProgress(this.#db, job.id, progress),
      });
      const status = controller.signal.aborted ? "cancelled" : "done";
      markJobFinished(this.#db, job.id, status);
      log.info(`job ${job.id} ${status}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markJobFinished(
        this.#db,
        job.id,
        controller.signal.aborted ? "cancelled" : "failed",
        message,
      );
      log.error(`job ${job.id} failed: ${message}`);
      throw error;
    }
  }

  cancel(id: string): boolean {
    const active = this.#active.get(id);
    if (!active) return false;
    active.abort();
    return true;
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const active = [...this.#active.values()];
    for (const job of active) job.abort();
    await Promise.allSettled(active.map((job) => job.finished));
  }

  get(id: string): Job | null {
    return getJob(this.#db, id);
  }
  list(limit?: number): Job[] {
    return listJobs(this.#db, limit);
  }
  active(): string[] {
    return [...this.#active.keys()];
  }
}
