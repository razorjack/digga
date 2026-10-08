"use strict";
/**
 * Loaded into Electron's main process with `-r`, before the app's first line, or in a packaged
 * build, which ignores -r, by the host while the app waits for it with DIGGA_E2E_HOLD=1
 * (docs/e2e/ELECTRON.md#startup-order). In order, it:
 *
 * 1. exits unless userData and every DIGGA_* path lie inside the test's temp folder, so no run
 *    can write to the owner's library or Chromium profile;
 * 2. installs the Node socket guard, in this process and in every worker it starts;
 * 3. replaces the native dialogs and shell.openExternal with recorders that answer as the test
 *    asks, records the progress bar and notifications, and saves downloads in the test's folder;
 * 4. holds the app's start until the host calls globalThis.diggaE2e.start(), so the host prepares
 *    the browser context before the window exists: Playwright cannot install routes on a context
 *    whose window waits for its first navigation;
 * 5. holds the window's first navigation until the host calls globalThis.diggaE2e.release().
 *
 * The host waits for the held navigation and reads what was recorded through
 * electronApp.evaluate().
 */
const fs = require("node:fs");
const path = require("node:path");

const { app } = require("electron");

refuseOutsideTestFolder();

const { pathToFileURL } = require("node:url");
const moduleApi = require("node:module");
const workerThreads = require("node:worker_threads");
const { BrowserWindow, Notification, dialog, session, shell } = require("electron");

const GUARD = path.join(__dirname, "guard.ts");

const recorded = {
  externalOpens: [],
  messageBoxes: [],
  openDialogs: [],
  progressBars: [],
  notifications: [],
  downloads: [],
};

/** The buttons the app's next message boxes are answered with, by label; the first button else. */
const messageBoxAnswers = [];

installGuard();
stubShell();
stubDialogs();
recordProgressAndNotifications();
saveDownloads(requiredPath("DIGGA_E2E_DOWNLOADS_DIR"));
const start = holdStart();
const navigation = holdFirstNavigation();

globalThis.diggaE2e = {
  recorded,
  /** Answers the app's next message box with the button labelled so. */
  answerMessageBox: (label) => messageBoxAnswers.push(label),
  start,
  /** Resolves with the URL the window's first loadURL() asked for, once it has. */
  heldUrl: navigation.held,
  /** Lets the held navigation go on, to the URL given or to the one the app asked for. */
  release: (url) => navigation.release(url),
};

function refuseOutsideTestFolder() {
  const root = process.env.DIGGA_E2E_TEMP_ROOT;
  const checked = { userData: app.getPath("userData") };
  for (const name of ["DIGGA_DATA_DIR", "DIGGA_DUMPS_DIR", "DIGGA_CONFIG_FILE"])
    if (process.env[name] !== undefined) checked[name] = process.env[name];
  for (const [name, value] of Object.entries(checked)) {
    if (root && path.isAbsolute(root) && isInside(root, value)) continue;
    process.stderr.write(
      `digga-e2e preload: refused to start: ${name} (${value}) is not inside the test's folder (${root})\n`,
    );
    process.exit(78);
  }
}

function isInside(root, value) {
  if (!path.isAbsolute(value)) return false;
  const relative = path.relative(realPath(root), realPath(value));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Electron reports userData through symlinks resolved (/private/var for /var on macOS). */
function realPath(value) {
  const missing = [];
  let existing = path.resolve(value);
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

function requiredPath(name) {
  const value = process.env[name];
  if (!value || !isInside(process.env.DIGGA_E2E_TEMP_ROOT, value))
    throw new Error(`${name} must name a folder inside the test's folder`);
  return value;
}

/**
 * The guard the CLI loads with NODE_OPTIONS, which Playwright removes from an Electron launch. A
 * worker started from a file does not inherit a module this preload loaded, so every worker
 * imports the guard first.
 */
function installGuard() {
  require(GUARD);
  const guardUrl = pathToFileURL(GUARD).href;
  const Worker = workerThreads.Worker;
  workerThreads.Worker = class GuardedWorker extends Worker {
    constructor(filename, options = {}) {
      const execArgv = options.execArgv ?? process.execArgv;
      super(filename, { ...options, execArgv: [`--import=${guardUrl}`, ...execArgv] });
    }
  };
  // The app imports Worker as an ES module binding, which follows the CommonJS export only now.
  moduleApi.syncBuiltinESMExports();
}

function stubShell() {
  shell.openExternal = async (url) => {
    recorded.externalOpens.push(url);
  };
}

/**
 * No native dialog opens. The app's own message boxes answer with the button the test named
 * through answerMessageBox(), else with their first, and an open dialog as cancelled. A page's
 * alert() or confirm() also reaches showMessageBox, with an abort signal: it stays unanswered
 * here, and the test answers it through Playwright's `dialog` event.
 */
function stubDialogs() {
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1);
    if (options.signal instanceof AbortSignal) return pageDialogAnswer(options.signal);
    const box = messageBoxOptions(options);
    recorded.messageBoxes.push(box);
    // A dialog before a quit, such as a startup error's, is printed: the record goes with the app.
    process.stderr.write(`digga-e2e preload: message box: ${JSON.stringify(box)}\n`);
    const response = box.buttons?.indexOf(box.answer) ?? 0;
    if (response < 0) throw new Error(`the message box has no button "${box.answer}"`);
    return { response, checkboxChecked: false };
  };
  dialog.showOpenDialog = async (...args) => {
    recorded.openDialogs.push(args.at(-1));
    return { canceled: true, filePaths: [] };
  };
}

/** Electron ignores the answer once the dialog was handled elsewhere and the signal aborted. */
function pageDialogAnswer(signal) {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ response: -1, checkboxChecked: false }));
  });
}

function messageBoxOptions({ type, message, detail, buttons }) {
  const answer = messageBoxAnswers.shift() ?? buttons?.[0];
  return { type, message, detail, buttons, answer };
}

/** The progress bar is set as asked; a notification is recorded and never shown. */
function recordProgressAndNotifications() {
  // oxlint-disable-next-line typescript/unbound-method -- called with the window through call().
  const setProgressBar = BrowserWindow.prototype.setProgressBar;
  BrowserWindow.prototype.setProgressBar = function recordProgressBar(progress, options) {
    recorded.progressBars.push({ progress, mode: options?.mode });
    return setProgressBar.call(this, progress, options);
  };
  Notification.prototype.show = function recordNotification() {
    recorded.notifications.push({ title: this.title, body: this.body });
  };
}

/** Downloads go to the folder without a save dialog; the host waits for their `done` state. */
function saveDownloads(folder) {
  void app.whenReady().then(() => {
    session.defaultSession.on("will-download", (_event, item) => {
      const file = path.join(folder, item.getFilename());
      fs.mkdirSync(folder, { recursive: true });
      item.setSavePath(file);
      const download = { name: item.getFilename(), path: file, state: "progressing" };
      recorded.downloads.push(download);
      item.once("done", (_doneEvent, state) => {
        download.state = state;
      });
    });
  });
}

/** The app's whenReady() resolves once Electron is ready and the host has called start(). */
function holdStart() {
  const started = Promise.withResolvers();
  const whenReady = app.whenReady.bind(app);
  app.whenReady = () => whenReady().then(() => started.promise);
  return () => started.resolve();
}

/**
 * The first loadURL() waits for release(), so the host can give the state and size the window
 * before the app's first request. Later calls go through at once. A failure of the held
 * navigation is printed to stderr, which the host reads after the app has exited (ELEC-14).
 */
function holdFirstNavigation() {
  // oxlint-disable-next-line typescript/unbound-method -- called with the window through call().
  const loadURL = BrowserWindow.prototype.loadURL;
  const held = Promise.withResolvers();
  const released = Promise.withResolvers();
  let holding = false;
  BrowserWindow.prototype.loadURL = function heldLoadURL(url, options) {
    if (holding) return loadURL.call(this, url, options);
    holding = true;
    held.resolve(url);
    const loading = released.promise.then((target) => loadURL.call(this, target ?? url, options));
    loading.catch((error) => {
      process.stderr.write(`digga-e2e preload: the first navigation failed: ${error.message}\n`);
    });
    return loading;
  };
  return { held: held.promise, release: (url) => released.resolve(url) };
}
