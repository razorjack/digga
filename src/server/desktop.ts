import type { Job } from "../shared/types.ts";
import type { JobListener } from "./jobs/runner.ts";

/**
 * What the Digga app's main process adds to the server (electron/desktop.ts, decisions 165 and
 * 168). The CLI's server has none, and nothing in src/ imports Electron: the server reports each
 * job change here, so the main process follows the downloads and loads without asking the page,
 * and the page reaches the native dialogs through the server's /api/desktop routes.
 */
export interface Desktop {
  /** A job started, reported progress or ended. */
  jobChanged(job: Job): void;
  /** Asks for a releases dump the user has, with the system's file dialog; null when cancelled. */
  chooseDumpFile(): Promise<string | null>;
  /** Asks for a folder for the dumps, starting at the current one; null when cancelled. */
  chooseDumpsFolder(current: string): Promise<string | null>;
}

/** The job runner's listener for the desktop, when there is one. */
export function desktopJobListener(desktop: Desktop | undefined): JobListener | undefined {
  if (!desktop) return undefined;
  return (job) => desktop.jobChanged(job);
}
