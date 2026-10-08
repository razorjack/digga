import { BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import type { Desktop } from "../src/server/desktop.ts";
import { type DumpJob, quitQuestion, runningDumpJobs } from "./dump-jobs.ts";

/**
 * The server's desktop (src/server/desktop.ts, decision 165): the main process follows the jobs
 * the server reports, so it knows which downloads and loads run without asking the page.
 */
export interface AppDesktop extends Desktop {
  /** The downloads and loads running now, in the order they started. */
  runningDumpJobs(): DumpJob[];
  /**
   * Whether to quit: during a download or load the user is asked first, since what quitting
   * stops starts over; with nothing of that running, true at once.
   */
  confirmQuit(): Promise<boolean>;
}

const QUIT = 0;

export function createDesktop(): AppDesktop {
  const running = runningDumpJobs();
  return {
    jobChanged: (job) => running.update(job),
    runningDumpJobs: () => running.list(),
    async confirmQuit() {
      const question = quitQuestion(running.list());
      if (!question) return true;
      const answer = await showMessageBox({
        type: "warning",
        ...question,
        buttons: ["Quit", "Cancel"],
        defaultId: QUIT,
        cancelId: 1,
      });
      return answer === QUIT;
    },
  };
}

/** The app's message box, attached to its window as a sheet when there is one; answers the button. */
async function showMessageBox(options: MessageBoxOptions): Promise<number> {
  const window = BrowserWindow.getAllWindows()[0];
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response;
}
