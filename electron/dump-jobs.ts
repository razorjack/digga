import type { Job } from "../src/shared/types.ts";

/**
 * What the downloads and loads the server reports mean for the app: whether one runs, for the
 * quit question, the Dock's progress bar and keeping the Mac awake. Pure, so vitest covers it.
 */

/** A job that downloads the catalogue, loads it, or does both. */
export type DumpJob = Extract<Job, { type: "dump_download" | "dump_load" | "dump_update" }>;

export function isDumpJob(job: Job): job is DumpJob {
  return job.type === "dump_download" || job.type === "dump_load" || job.type === "dump_update";
}

function isRunning(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}

/** The downloads and loads running now, kept up to date from the server's job reports. */
export interface RunningDumpJobs {
  /** Takes in a reported job; other jobs are ignored. */
  update(job: Job): void;
  /** In the order they started. */
  list(): DumpJob[];
}

export function runningDumpJobs(): RunningDumpJobs {
  const running = new Map<string, DumpJob>();
  return {
    update(job) {
      if (!isDumpJob(job)) return;
      if (isRunning(job)) running.set(job.id, job);
      else running.delete(job.id);
    },
    list: () => [...running.values()],
  };
}
