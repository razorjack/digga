import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  Notification,
  type OpenDialogOptions,
  powerSaveBlocker,
  shell,
} from "electron";
import type { Desktop } from "../src/server/desktop.ts";
import type { Logger } from "../src/server/logger.ts";
import type { Job } from "../src/shared/types.ts";
import {
  type DumpJob,
  loadEndNotice,
  type Notice,
  progressBarValue,
  quitQuestion,
  runningDumpJobs,
} from "./dump-jobs.ts";

/**
 * The server's desktop (src/server/desktop.ts, decisions 165 and 168): the main process follows
 * the jobs the server reports, so it shows the download and the load on the Dock, keeps the Mac
 * awake while they run, says when a load ends unseen, and knows what quitting would stop, without
 * asking the page; it shows the file and folder dialogs the setup asks for, and explains Full
 * Disk Access when a history import may not read a browser's history.
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

const DUMP_FILE_DIALOG: OpenDialogOptions = {
  title: "Use a dump file you have",
  properties: ["openFile"],
  // macOS filters on the last part of an extension, .gz, so the server checks for .xml.gz.
  filters: [{ name: "Discogs releases dump", extensions: ["xml.gz"] }],
};

const DUMPS_FOLDER_DIALOG: OpenDialogOptions = {
  title: "Choose a folder for the catalogue",
  buttonLabel: "Choose",
  properties: ["openDirectory", "createDirectory"],
};

/** Privacy & Security › Full Disk Access in System Settings. */
const FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const OPEN_SETTINGS = 0;

export function createDesktop(logger: Logger): AppDesktop {
  const running = runningDumpJobs();
  const dock = dockProgress();
  const awake = keepAwake(logger);
  const notices = noticesWhenUnseen(logger);
  return {
    jobChanged(job: Job) {
      running.update(job);
      dock.show(progressBarValue(running.list()));
      awake.set(running.list().length > 0);
      notices.tell(loadEndNotice(job));
    },
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
    chooseDumpFile: () => showOpenDialog(DUMP_FILE_DIALOG),
    chooseDumpsFolder: (current) =>
      showOpenDialog({ ...DUMPS_FOLDER_DIALOG, defaultPath: current }),
    historyAccessDenied() {
      if (process.platform !== "darwin") return;
      askToOpenFullDiskAccess(logger).catch((error: unknown) =>
        logger.warn("the Full Disk Access dialog failed", error),
      );
    },
  };
}

function appWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

/** The window's progress bar, on the Dock icon in macOS; set again only when its value changes. */
function dockProgress(): { show(value: number): void } {
  let shown: number | null = null;
  return {
    show(value) {
      const window = appWindow();
      if (!window || value === shown) return;
      shown = value;
      window.setProgressBar(value);
    },
  };
}

/** A sleeping Mac would break the download, so the app keeps it awake while either job runs. */
function keepAwake(logger: Logger): { set(awake: boolean): void } {
  let blocker: number | null = null;
  return {
    set(awake) {
      if (awake && blocker === null) {
        blocker = powerSaveBlocker.start("prevent-app-suspension");
        logger.info("keeping the computer awake while the catalogue downloads or loads");
      }
      if (!awake && blocker !== null) {
        powerSaveBlocker.stop(blocker);
        blocker = null;
        logger.info("the computer may sleep again");
      }
    },
  };
}

/**
 * A notification when a load ends while no window of the app is focused. It is logged first:
 * Notification.isSupported() and the constructor ask macOS for permission the first time, and
 * the E2E preload answers isSupported() with false, so the tests read the log.
 */
function noticesWhenUnseen(logger: Logger): { tell(notice: Notice | null): void } {
  // Notification Center removes a notification once its object is collected.
  let shown: Notification | null = null;
  return {
    tell(notice) {
      if (!notice || BrowserWindow.getFocusedWindow() !== null) return;
      logger.info(`notification: ${notice.title}: ${notice.body}`);
      if (!Notification.isSupported()) return;
      shown = new Notification(notice);
      shown.on("click", showWindow);
      shown.show();
    },
  };
}

function showWindow(): void {
  const window = appWindow();
  if (window?.isMinimized()) window.restore();
  window?.focus();
}

/**
 * macOS lets an app read another app's data only with Full Disk Access, which the user grants in
 * System Settings; the app cannot ask for it. Settings' job row keeps the import's own message.
 */
async function askToOpenFullDiskAccess(logger: Logger): Promise<void> {
  const answer = await showMessageBox({
    type: "info",
    message: "Digga may not read the browser's history",
    detail:
      "macOS lets Digga read another app's data only with Full Disk Access. Turn on Digga under " +
      "Privacy & Security › Full Disk Access in System Settings, open Digga again, and import " +
      "the history once more.",
    buttons: ["Open Privacy & Security", "Not Now"],
    defaultId: OPEN_SETTINGS,
    cancelId: 1,
  });
  if (answer !== OPEN_SETTINGS) return;
  logger.info("opening Full Disk Access in System Settings");
  await shell.openExternal(FULL_DISK_ACCESS_URL);
}

/** The app's open dialog, a sheet on its window when there is one; the file chosen, or null. */
async function showOpenDialog(options: OpenDialogOptions): Promise<string | null> {
  const window = appWindow();
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (canceled) return null;
  return filePaths[0] ?? null;
}

/** The app's message box, attached to its window as a sheet when there is one; answers the button. */
async function showMessageBox(options: MessageBoxOptions): Promise<number> {
  const window = appWindow();
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response;
}
