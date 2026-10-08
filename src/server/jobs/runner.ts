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

/**
 * Hears every change of a job: its start, each progress report, and its end, with the error it
 * failed with. The Digga app follows its downloads and loads through it (src/server/desktop.ts).
 */
export type JobListener = (job: Job, failure?: unknown) => void;

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

export function createJobRunner(db: Db, logger: Logger, listener?: JobListener): JobRunner {
  return new Runner(db, logger, listener);
}

class Runner implements JobRunner {
  #db: Db;
  #logger: Logger;
  #listener: JobListener | undefined;
  #active = new Map<string, ActiveJob>();
  #stopping = false;

  constructor(db: Db, logger: Logger, listener: JobListener | undefined) {
    this.#db = db;
    this.#logger = logger;
    this.#listener = listener;
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
    this.#report(job.id);
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
        onProgress: (progress) => {
          updateJobProgress(this.#db, job.id, progress);
          this.#report(job.id);
        },
      });
      const status = controller.signal.aborted ? "cancelled" : "done";
      markJobFinished(this.#db, job.id, status);
      this.#report(job.id);
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
      this.#report(job.id, error);
      log.error(`job ${job.id} failed: ${message}`);
      throw error;
    }
  }

  /** Tells the listener what the jobs table holds now; a listener's failure leaves the job alone. */
  #report(id: string, failure?: unknown): void {
    const job = this.#listener ? getJob(this.#db, id) : null;
    if (!job) return;
    try {
      this.#listener?.(job, failure);
    } catch (error) {
      this.#logger.warn(`the listener of job ${id} failed`, error);
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
    // A Discogs request in flight takes no abort signal, so the wait can take seconds.
    if (active.length > 0)
      this.#logger.info(`stopping: cancelled ${active.length} running job(s), waiting for them`);
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
