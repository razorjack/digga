import type { Job } from "../shared/types.ts";
import type { JobListener } from "./jobs/runner.ts";

/**
 * What the Digga app's main process adds to the server (electron/desktop.ts, decision 165). The
 * CLI's server has none, and nothing in src/ imports Electron: the server reports each job change
 * here, so the main process follows the downloads and loads without asking the page.
 */
export interface Desktop {
  /** A job started, reported progress or ended. */
  jobChanged(job: Job): void;
}

/** The job runner's listener for the desktop, when there is one. */
export function desktopJobListener(desktop: Desktop | undefined): JobListener | undefined {
  if (!desktop) return undefined;
  return (job) => desktop.jobChanged(job);
}
