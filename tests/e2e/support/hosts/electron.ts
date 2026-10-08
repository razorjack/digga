import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  _electron,
  type BrowserContext,
  type ElectronApplication,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { videoCatalogue } from "../../fixtures/catalogue.ts";
import {
  AppApiClient,
  type DiggaApp,
  type DiggaHost,
  FakeYouTubeHandle,
  Given,
  PAGE_SETTINGS,
  PageClock,
  pasteText,
  type ProcessOutput,
} from "../app.ts";
import { type ContextGuard, guardContext, HOST_RESOLVER_RULES } from "../browser-guard.ts";
import { BrowserLog, type ExpectedProblems } from "../browser-log.ts";
import { type AbortedRequests, abortRequests, type RequestMatch } from "../fault-routes.ts";
import { fakeYouTubeScript } from "../fake-youtube.ts";
import {
  assertInside,
  checkPaths,
  type CollectedOutput,
  collectOutput,
  type DiggaEnvironment,
  type DiggaLibrary,
  type DiggaRun,
  diggaVariables,
  exited,
  runDigga,
  timeout,
} from "../spawn.ts";

/**
 * The Electron app with the harness preload, on the test's library, with userData in the test's
 * folder (docs/e2e/ELECTRON.md): unpackaged, electron/main.ts from this repository, or a packaged
 * build's inspectable variant. The server runs in the main process, so a relaunch replaces the
 * whole app, and there is no restartServer().
 */

const APP_DIR = fileURLToPath(new URL("../../../../", import.meta.url));
const PRELOAD = fileURLToPath(new URL("../electron-preload.cjs", import.meta.url));
const START_TIMEOUT_MS = 15_000;
/** As for `digga serve`: a server that does not stop is a bug, and fails the test. */
const STOP_TIMEOUT_MS = 15_000;
/**
 * Electron's own exit after its server has stopped, which took 0.2 s in the spike but more than
 * 20 s in the rehearsal (docs/e2e/HISTORY.md#the-electron-main-process-electron-unpackaged); the
 * host kills it after this and says so.
 */
const EXIT_TIMEOUT_MS = 10_000;
/** How often the host reads digga.log while it waits for a line; the app writes it synchronously. */
const LOG_POLL_MS = 50;

/** One of the app's own message boxes, and the button the preload answered it with. */
export interface MessageBox {
  type?: string;
  message: string;
  detail?: string;
  buttons?: string[];
  answer?: string;
}

/** One of the app's open dialogs, and the files the preload answered it with; none is cancelled. */
export interface OpenDialog {
  title?: string;
  properties?: string[];
  filters?: { name: string; extensions: string[] }[];
  filePaths: string[];
}

/** What the preload records in the main process (tests/e2e/support/electron-preload.cjs). */
export interface MainProcessRecord {
  externalOpens: string[];
  messageBoxes: MessageBox[];
  openDialogs: OpenDialog[];
  progressBars: { progress: number; mode?: string }[];
  powerSaveBlockers: { call: "start" | "stop"; type?: string; id: number }[];
  /** Notifications shown although the preload answers Notification.isSupported() with false. */
  notifications: { title: string; body: string }[];
  downloads: { name: string; path: string; state: string }[];
}

interface PreloadApi {
  recorded: MainProcessRecord;
  answerMessageBox(label: string): void;
  answerOpenDialog(filePaths: string[]): void;
  start(): void;
  heldUrl: Promise<string>;
  release(url?: string): void;
}

declare global {
  var diggaE2e: PreloadApi | undefined;
  /** Set by electron/main.ts while a packaged build waits for the host (DIGGA_E2E_HOLD=1). */
  var diggaE2eHold: { release(): void } | undefined;
}

/** The app while its window waits for the first navigation: its server runs, nothing has loaded. */
export interface HeldApp {
  electronApp: ElectronApplication;
  /** The URL the app's window was told to load. */
  url: string;
}

export interface ElectronAppOptions {
  environment: DiggaEnvironment;
  /** A packaged build's executable, or null for electron/main.ts from this repository. */
  executablePath: string | null;
  /** The test's temp folder; userData, downloads and every path the app gets lie inside it. */
  testFolder: string;
  /** Saved through PUT /api/discogs/token before the page first opens. */
  savedToken: string | null;
  /** Installs Playwright's clock before the app starts. */
  clock: boolean;
  /** Runs at the first launch while the window's first navigation is held (ELEC-10, ELEC-13). */
  beforeRelease: ((held: HeldApp) => Promise<void>) | null;
}

/** One start of the app: its process, its window and the server in it. */
interface Launch {
  electronApp: ElectronApplication;
  /** Its lines of digga.log, and its stderr. */
  server: ProcessOutput;
  page: Page;
  api: AppApiClient;
  heldUrl: string;
  /** Indices of the external opens a test expected through expectExternalOpen(). */
  expectedOpens: Set<number>;
  /** Indices of the message boxes a test expected through expectMessageBox(). */
  expectedBoxes: Set<number>;
  tracing: boolean;
}

export class ElectronApp implements DiggaHost {
  readonly given: Given;
  readonly youtube: FakeYouTubeHandle;
  readonly clock: PageClock;
  readonly log = new BrowserLog();
  readonly servers: ProcessOutput[] = [];
  readonly #options: ElectronAppOptions;
  /** The options' environment, on the library a relaunch moved to. */
  #environment: DiggaEnvironment;
  #launch: Launch | null = null;
  /** What earlier launches did that the test did not declare. */
  readonly #problems: string[] = [];
  /** Traces of earlier launches, in the test's folder, attached when the test fails. */
  readonly #traces: string[] = [];

  private constructor(options: ElectronAppOptions) {
    this.#options = options;
    this.#environment = options.environment;
    this.given = new Given(() => this.api);
    this.youtube = new FakeYouTubeHandle(() => this.page);
    this.clock = new PageClock(() => this.page, options.clock);
  }

  static async launch(options: ElectronAppOptions): Promise<ElectronApp> {
    const app = new ElectronApp(options);
    await app.#start(async (api, held) => {
      if (options.savedToken)
        await api.send("PUT", "/api/discogs/token", { token: options.savedToken });
      await options.beforeRelease?.(held);
    });
    return app;
  }

  get library(): DiggaLibrary {
    return this.#environment.library;
  }

  get page(): Page {
    return this.#current.page;
  }

  get api(): AppApiClient {
    return this.#current.api;
  }

  get origin(): string {
    return new URL(this.#current.heldUrl).origin;
  }

  get server(): ProcessOutput {
    return this.servers.at(-1)!;
  }

  get electronApp(): ElectronApplication {
    return this.#current.electronApp;
  }

  /** The URL the app's window was told to load, which the host held and replaced with a blank page. */
  get windowUrl(): string {
    return this.#current.heldUrl;
  }

  get userDataDir(): string {
    return path.join(this.#options.testFolder, "user-data");
  }

  get downloadsDir(): string {
    return path.join(this.#options.testFolder, "downloads");
  }

  async open(hash = "#/triage"): Promise<void> {
    await this.page.goto(`${this.origin}/${hash}`);
  }

  openPage(): Promise<DiggaApp> {
    throw new Error("the Electron app opens no second window; tag a test that needs one @web");
  }

  async relaunch(options: { crash?: boolean; library?: DiggaLibrary } = {}): Promise<void> {
    await this.#stop({ crash: options.crash, keepTrace: true });
    if (options.library) this.#environment = { ...this.#environment, library: options.library };
    await this.#start(async () => {});
  }

  /**
   * Quits the app and launches it again, then asks it to quit while its window waits for the first
   * navigation, as a quit during the start does (ELEC-14). `beforeQuit` gives the server something
   * its stop waits for, such as a job; the held navigation then goes to the app's page, which the
   * stopping server refuses, and once it has failed `afterNavigationFailed` lets the stop finish.
   * Resolves with the exit code once the app has exited; it is not running afterwards, and the
   * launch's output is the last of `servers`.
   */
  async quitDuringStart(hooks: {
    beforeQuit(api: AppApiClient): Promise<void>;
    afterNavigationFailed(): void | Promise<void>;
  }): Promise<number | null> {
    await this.#stop({ keepTrace: true });
    const { electronApp, output, server } = await this.#launchElectron();
    const child = electronApp.process();
    const exit = exited(child);
    try {
      if (this.#options.executablePath) await preloadHeldApp(electronApp, output);
      const guard = await this.#prepareContext(electronApp.context());
      const heldUrl = await this.#startApp(electronApp, output);
      guard.allowOrigin(new URL(heldUrl).origin);
      // The app exits before a trace could be saved.
      await electronApp.context().tracing.stop();
      await hooks.beforeQuit(new AppApiClient(Number(new URL(heldUrl).port)));

      await electronApp.evaluate(({ app }) => {
        app.quit();
        globalThis.diggaE2e!.release();
      });
      await waitForOutput(() => server.stderr, /the first navigation failed: /, START_TIMEOUT_MS);
      await hooks.afterNavigationFailed();
      const code = await Promise.race([exit, timeout(STOP_TIMEOUT_MS + EXIT_TIMEOUT_MS)]);
      if (code === "timeout") throw new Error(`the Electron app did not exit:\n${output.all()}`);
      return code;
    } finally {
      // Playwright no longer reaches an app that has exited.
      child.kill("SIGKILL");
      await exit;
      await electronApp.close().catch(() => {});
    }
  }

  restartServer(): Promise<void> {
    throw new Error("the Electron app's server runs in its main process; tag the test @web");
  }

  async cli(args: string[], options: { library?: DiggaLibrary } = {}): Promise<DiggaRun> {
    return runDigga(args, { ...this.#environment, library: options.library ?? this.library });
  }

  async paste(text: string): Promise<void> {
    await pasteText(this.page, text);
  }

  /** The app hands external URLs to shell.openExternal, which the preload records instead. */
  async expectExternalOpen(action: () => Promise<void>): Promise<string> {
    const launch = this.#current;
    const index = (await this.recorded()).externalOpens.length;
    await action();
    let opened: string | undefined;
    await expect
      .poll(async () => {
        opened = (await this.recorded()).externalOpens[index];
        return opened;
      }, "the app opening an external URL")
      .toBeDefined();
    launch.expectedOpens.add(index);
    return opened!;
  }

  /**
   * The app's own message box that the action makes it show, answered with the button labelled
   * `answer`. The preload answers it at once; a box the test expects this way is no problem.
   */
  async expectMessageBox(action: () => Promise<void>, answer: string): Promise<MessageBox> {
    const launch = this.#current;
    const index = (await this.recorded()).messageBoxes.length;
    await launch.electronApp.evaluate(
      (_electron, label) => globalThis.diggaE2e!.answerMessageBox(label),
      answer,
    );
    await action();
    let box: MessageBox | undefined;
    await expect
      .poll(async () => {
        box = (await this.recorded()).messageBoxes[index];
        return box;
      }, "the app's message box")
      .toBeDefined();
    launch.expectedBoxes.add(index);
    return box!;
  }

  /** The app's next open dialog answers with the files given; an open dialog cancels else. */
  async answerOpenDialog(filePaths: string[]): Promise<void> {
    await this.#current.electronApp.evaluate(
      (_electron, files) => globalThis.diggaE2e!.answerOpenDialog(files),
      filePaths,
    );
  }

  /**
   * Whether the main process finds one of its windows focused. A real focus change would take
   * focus from the developer's other apps, so this replaces BrowserWindow.getFocusedWindow().
   */
  async setFocused(focused: boolean): Promise<void> {
    await this.#current.electronApp.evaluate(({ BrowserWindow }, isFocused) => {
      const window = BrowserWindow.getAllWindows()[0] ?? null;
      BrowserWindow.getFocusedWindow = () => (isFocused ? window : null);
    }, focused);
  }

  /** The preload saves each download in the test's folder; this waits for its `done` state. */
  async expectDownload(action: () => Promise<void>): Promise<{ name: string; path: string }> {
    const index = (await this.recorded()).downloads.length;
    await action();
    let download: MainProcessRecord["downloads"][number] | undefined;
    await expect
      .poll(async () => {
        download = (await this.recorded()).downloads[index];
        return download?.state;
      }, "the download to end")
      .toMatch(/^(completed|cancelled|interrupted)$/);
    if (download!.state !== "completed")
      throw new Error(`the download of ${download!.name} ended ${download!.state}`);
    return { name: download!.name, path: download!.path };
  }

  async abortRequests(
    match: RequestMatch,
    options: { times?: number } = {},
  ): Promise<AbortedRequests> {
    return abortRequests(this.#current.electronApp.context(), match, {
      times: options.times ?? 1,
      onAbort: (request) => this.log.recordAbort(request),
    });
  }

  apiRequests(): string[] {
    return [...this.log.apiRequests];
  }

  expectProblems(problems: ExpectedProblems): void {
    this.log.expect(problems);
  }

  /** What the preload recorded in the current launch's main process. */
  async recorded(): Promise<MainProcessRecord> {
    return this.#current.electronApp.evaluate(() => globalThis.diggaE2e!.recorded);
  }

  async undeclaredProblems(): Promise<string[]> {
    const current = this.#launch ? await this.#mainProcessProblems(this.#launch) : [];
    return [...this.log.undeclared(), ...this.#problems, ...current];
  }

  /** The runner's screenshot and trace options do not reach an Electron app. */
  async attachFailureArtifacts(testInfo: TestInfo): Promise<void> {
    const launch = this.#launch;
    if (launch) {
      const screenshot = await launch.page.screenshot().catch(() => null);
      if (screenshot)
        await testInfo.attach("screenshot.png", { body: screenshot, contentType: "image/png" });
      await this.#stopTracing(launch, this.#traceFile());
    }
    // attach() copies the file, so the test's folder can go after the test.
    for (const [index, trace] of this.#traces.entries())
      await testInfo.attach(`trace-launch-${index + 1}`, {
        path: trace,
        contentType: "application/zip",
      });
  }

  /** A passing test's last trace is not kept. */
  async close(): Promise<void> {
    if (this.#launch) await this.#stop({ keepTrace: false });
  }

  get running(): boolean {
    return this.#launch !== null;
  }

  get #current(): Launch {
    if (!this.#launch) throw new Error("the app is not running");
    return this.#launch;
  }

  /**
   * Launches the app with the preload, prepares its context before the window exists, gives the
   * state while the first navigation is held, and releases it to a blank page, which stays blank
   * until open() as a web page does (docs/e2e/ELECTRON.md#startup-order).
   */
  async #start(given: (api: AppApiClient, held: HeldApp) => Promise<void>): Promise<void> {
    const { electronApp, output, server } = await this.#launchElectron();
    try {
      if (this.#options.executablePath) await preloadHeldApp(electronApp, output);
      const guard = await this.#prepareContext(electronApp.context());
      const heldUrl = await this.#startApp(electronApp, output);
      guard.allowOrigin(new URL(heldUrl).origin);
      this.#checkLibrary();
      const api = new AppApiClient(Number(new URL(heldUrl).port));
      await given(api, { electronApp, url: heldUrl });

      const page = await releaseToBlankPage(electronApp);
      this.#launch = {
        electronApp,
        server,
        page,
        api,
        heldUrl,
        expectedOpens: new Set(),
        expectedBoxes: new Set(),
        tracing: true,
      };
    } catch (error) {
      await kill(electronApp);
      throw error;
    }
  }

  async #launchElectron(): Promise<{
    electronApp: ElectronApplication;
    output: CollectedOutput;
    server: ProcessOutput;
  }> {
    const { testFolder, executablePath } = this.#options;
    const environment = this.#environment;
    const args = [
      // A packaged build ignores -r and runs its own app; preloadHeldApp() loads the preload there.
      ...(executablePath ? [] : ["-r", PRELOAD, APP_DIR]),
      `--user-data-dir=${this.userDataDir}`,
      // Playwright adds these only with its own loader; passed here, no run touches a real keychain.
      "--use-mock-keychain",
      "--password-store=basic",
      HOST_RESOLVER_RULES,
    ];
    checkLaunch(args, environment, testFolder);
    const logFile = path.join(this.userDataDir, "digga.log");
    const logStart = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    const electronApp = await _electron.launch({
      executablePath: executablePath ?? undefined,
      args,
      cwd: environment.cwd,
      env: electronVariables(environment, {
        testFolder,
        downloadsDir: this.downloadsDir,
        hold: executablePath !== null,
      }),
      locale: PAGE_SETTINGS.locale,
      timezoneId: PAGE_SETTINGS.timezoneId,
      colorScheme: PAGE_SETTINGS.colorScheme,
      timeout: START_TIMEOUT_MS,
    });
    const output = collectOutput(electronApp.process());
    const server = serverOutput(output, logFile, logStart);
    this.servers.push(server);
    return { electronApp, output, server };
  }

  /** Everything the page needs before the app's first script, installed before the window exists. */
  async #prepareContext(context: BrowserContext): Promise<ContextGuard> {
    const guard = await guardContext(context, this.log.guard);
    await context.addInitScript(fakeYouTubeScript(videoCatalogue()));
    if (this.#options.clock) await context.clock.install();
    this.log.watch(context);
    await context.tracing.start({ screenshots: true, snapshots: true });
    return guard;
  }

  /** Lets the app start, and returns the URL its window asks for once its server runs. */
  async #startApp(electronApp: ElectronApplication, output: CollectedOutput): Promise<string> {
    await electronApp.evaluate(() => globalThis.diggaE2e!.start());
    const held = electronApp.evaluate(() => globalThis.diggaE2e!.heldUrl);
    const outcome = await Promise.race([held, timeout(START_TIMEOUT_MS)]).catch(
      (error: unknown) => error,
    );
    if (typeof outcome === "string" && outcome !== "timeout") return outcome;
    throw new Error(
      `the Electron app did not open its window (${String(outcome)}):\n${output.all()}`,
    );
  }

  /**
   * The library line the app logs once its server runs, compared as a second check. The log keeps
   * every launch's lines, so the last one is this launch's.
   */
  #checkLibrary(): void {
    const log = fs.readFileSync(path.join(this.userDataDir, "digga.log"), "utf8");
    const library = [...log.matchAll(/\] library: (.*), dumps: /g)].at(-1)?.[1];
    if (library !== this.library.dataDir)
      throw new Error(`the Electron app opened ${library}, not ${this.library.dataDir}`);
  }

  /**
   * Quits through the app, or kills it for a crash, and keeps what the launch left to report: the
   * problems in its main process, and its trace when a later failure may need it.
   */
  async #stop(options: { crash?: boolean; keepTrace: boolean }): Promise<void> {
    const launch = this.#current;
    this.#launch = null;
    this.#problems.push(...(await this.#mainProcessProblems(launch).catch(() => [])));
    if (launch.tracing && options.keepTrace) await this.#stopTracing(launch, this.#traceFile());
    else if (launch.tracing) await launch.electronApp.context().tracing.stop();
    // As the web host closes its context first: none of the page's requests meets a stopped server.
    await launch.page.goto("about:blank");
    if (options.crash) await kill(launch.electronApp);
    else await quit(launch);
  }

  async #mainProcessProblems(launch: Launch): Promise<string[]> {
    const recorded = await launch.electronApp.evaluate(() => globalThis.diggaE2e!.recorded);
    const opens = recorded.externalOpens.filter((_url, index) => !launch.expectedOpens.has(index));
    return [
      ...opens.map((url) => `the app opened ${url} outside expectExternalOpen()`),
      ...recorded.messageBoxes
        .filter((_box, index) => !launch.expectedBoxes.has(index))
        .map((box) => `the app showed a message box: ${box.message}`),
      ...recorded.notifications.map(
        (notification) => `the app showed a notification: ${notification.title}`,
      ),
    ];
  }

  #traceFile(): string {
    return path.join(this.#options.testFolder, "traces", `launch-${this.#traces.length + 1}.zip`);
  }

  async #stopTracing(launch: Launch, file: string): Promise<void> {
    launch.tracing = false;
    await launch.electronApp.context().tracing.stop({ path: file });
    this.#traces.push(file);
  }
}

/**
 * A packaged build ignores -r: with DIGGA_E2E_HOLD=1 it waits at its start (electron/main.ts), and
 * the preload is loaded through the inspector, before the app's own code goes on. The preload's
 * refusal exits the app here, with its line on stderr.
 */
export async function preloadHeldApp(
  electronApp: ElectronApplication,
  output: CollectedOutput,
): Promise<void> {
  try {
    await expect
      .poll(() => electronApp.evaluate(() => globalThis.diggaE2eHold !== undefined), {
        message: "the packaged app to wait for the host",
        timeout: START_TIMEOUT_MS,
      })
      .toBe(true);
    await electronApp.evaluate((_electron, preload) => {
      const { createRequire } = process.getBuiltinModule("node:module");
      createRequire(preload)(preload);
      globalThis.diggaE2eHold!.release();
    }, PRELOAD);
  } catch (error) {
    throw new Error(
      `the host could not prepare the packaged app (${String(error)}):\n${output.all()}`,
    );
  }
}

/**
 * The launch's lines of digga.log, which the app writes in both forms; a packaged app prints none
 * of them, and an unpackaged one prints the same lines. The log keeps every launch's lines.
 */
function serverOutput(output: CollectedOutput, logFile: string, logStart: number): ProcessOutput {
  return {
    get stdout() {
      if (!fs.existsSync(logFile)) return "";
      return fs.readFileSync(logFile).subarray(logStart).toString("utf8");
    },
    get stderr() {
      return output.stderr();
    },
  };
}

/** The CLI's isolated environment, without NODE_OPTIONS, which Playwright removes: the preload guards. */
function electronVariables(
  environment: DiggaEnvironment,
  launch: { testFolder: string; downloadsDir: string; hold: boolean },
): Record<string, string> {
  const variables = {
    ...diggaVariables(environment),
    DIGGA_E2E_TEMP_ROOT: launch.testFolder,
    DIGGA_E2E_DOWNLOADS_DIR: launch.downloadsDir,
    DIGGA_E2E_HOLD: launch.hold ? "1" : undefined,
  };
  return Object.fromEntries(
    Object.entries(variables).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * Electron's userData is the owner's library folder unless --user-data-dir moves it, so the host
 * refuses a launch without one in the test's folder; the preload checks again in the app.
 */
function checkLaunch(args: string[], environment: DiggaEnvironment, testFolder: string): void {
  checkPaths([], { ...environment, root: testFolder });
  const userData = args.find((arg) => arg.startsWith("--user-data-dir="));
  if (!userData) throw new Error("the Electron app needs --user-data-dir in the test's folder");
  assertInside(testFolder, userData.slice("--user-data-dir=".length), "--user-data-dir");
}

/**
 * The held navigation goes to about:blank, so the window has a page before open(), as a web
 * page does. macOS keeps a window within the screen, so the page's viewport is set as well as the
 * window's size; reduced motion is not a launch option.
 */
async function releaseToBlankPage(electronApp: ElectronApplication): Promise<Page> {
  const { viewport, reducedMotion } = PAGE_SETTINGS;
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height);
  }, viewport);
  await electronApp.evaluate(() => globalThis.diggaE2e!.release("about:blank"));
  const page = await electronApp.firstWindow();
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize(viewport);
  return page;
}

/**
 * app.quit() runs before-quit, which waits for server.stop(). A server that does not stop fails
 * the test; an Electron that lingers after its server stopped is killed, and the host says so.
 */
async function quit(launch: Launch): Promise<void> {
  const child = launch.electronApp.process();
  const exit = exited(child);
  // The process can exit before it answers.
  await launch.electronApp.evaluate(({ app }) => app.quit()).catch(() => {});
  const waiting = new AbortController();
  const stopped = await Promise.race([
    waitForLogLine(launch.server, /\] stopped$/m, waiting.signal),
    exit,
    timeout(STOP_TIMEOUT_MS),
  ]);
  waiting.abort();
  if (stopped === "timeout") {
    await kill(launch.electronApp);
    throw new Error(`the Electron app's server did not stop within ${STOP_TIMEOUT_MS / 1000} s`);
  }
  if ((await Promise.race([exit, timeout(EXIT_TIMEOUT_MS)])) === "timeout") {
    console.warn(
      `digga-e2e: killed the Electron app (process ${child.pid}), still running ${EXIT_TIMEOUT_MS / 1000} s after its server stopped`,
    );
    await kill(launch.electronApp);
  }
  await launch.electronApp.close().catch(() => {});
}

async function kill(electronApp: ElectronApplication): Promise<void> {
  const child = electronApp.process();
  child.kill("SIGKILL");
  await exited(child);
  await electronApp.close().catch(() => {});
}

/** Resolves once the output has a match, which the app may write after it has stopped answering. */
async function waitForOutput(
  read: () => string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pattern.test(read())) {
    if (Date.now() > deadline)
      throw new Error(
        `the Electron app wrote nothing matching ${pattern} within ${timeoutMs / 1000} s`,
      );
    await sleep(LOG_POLL_MS);
  }
}

/** Resolves once the launch's log has a matching line, and never once the signal aborts. */
async function waitForLogLine(
  server: ProcessOutput,
  pattern: RegExp,
  signal: AbortSignal,
): Promise<void> {
  while (!pattern.test(server.stdout)) {
    const aborted = await sleep(LOG_POLL_MS, false, { signal }).catch(() => true);
    if (aborted) return new Promise(() => {});
  }
}
