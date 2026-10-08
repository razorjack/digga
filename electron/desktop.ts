import type { Desktop } from "../src/server/desktop.ts";
import { type DumpJob, runningDumpJobs } from "./dump-jobs.ts";

/**
 * The server's desktop (src/server/desktop.ts, decision 165): the main process follows the jobs
 * the server reports, so it knows which downloads and loads run without asking the page.
 */
export interface AppDesktop extends Desktop {
  /** The downloads and loads running now, in the order they started. */
  runningDumpJobs(): DumpJob[];
}

export function createDesktop(): AppDesktop {
  const running = runningDumpJobs();
  return {
    jobChanged: (job) => running.update(job),
    runningDumpJobs: () => running.list(),
  };
}
