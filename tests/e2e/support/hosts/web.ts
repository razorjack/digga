import path from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, Page, Route } from "@playwright/test";
import { videoCatalogue } from "../../fixtures/catalogue.ts";
import { AppApiClient, type DiggaApp, FakeYouTubeHandle, Given, PageClock } from "../app.ts";
import { guardContext } from "../browser-guard.ts";
import { BrowserLog, type ExpectedProblems } from "../browser-log.ts";
import { type AbortedRequests, abortRequests, type RequestMatch } from "../fault-routes.ts";
import { fakeYouTubeScript } from "../fake-youtube.ts";
import {
  type DiggaEnvironment,
  type DiggaLibrary,
  type DiggaRun,
  type DiggaServer,
  runDigga,
  startDiggaServer,
} from "../spawn.ts";

/** The same window for every test: the header's breakpoints change accessible names. */
export const CONTEXT_OPTIONS: BrowserContextOptions = {
  viewport: { width: 1600, height: 1000 },
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "dark",
  reducedMotion: "reduce",
  serviceWorkers: "block",
};

export interface WebAppOptions {
  browser: Browser;
  environment: DiggaEnvironment;
  /** Saved through PUT /api/discogs/token before the page first opens. */
  savedToken: string | null;
  /** Installs Playwright's clock in every context before the app starts. */
  clock: boolean;
  /** The test's output folder, where downloads are saved. */
  outputDir: string;
}

/** One start of the app: its server process and the browser context that talks to it. */
interface Launch {
  server: DiggaServer;
  context: BrowserContext;
  page: Page;
  api: AppApiClient;
}

/**
 * The browser app: the CLI's server in its own process, and a prepared Chromium context. A
 * relaunch replaces both; the library, the problem log and the list of servers stay.
 */
export class WebApp implements DiggaApp {
  readonly library: DiggaLibrary;
  readonly given: Given;
  readonly youtube: FakeYouTubeHandle;
  readonly clock: PageClock;
  readonly log = new BrowserLog();
  /** Every server this test started, the current one last, for the failure artifacts. */
  readonly servers: DiggaServer[] = [];
  readonly #options: WebAppOptions;
  #launch: Launch | null = null;

  private constructor(options: WebAppOptions) {
    this.#options = options;
    this.library = options.environment.library;
    this.given = new Given(() => this.api);
    this.youtube = new FakeYouTubeHandle(() => this.page);
    this.clock = new PageClock(() => this.page, options.clock);
  }

  static async launch(options: WebAppOptions): Promise<WebApp> {
    const app = new WebApp(options);
    await app.#start(async (api) => {
      if (options.savedToken)
        await api.send("PUT", "/api/discogs/token", { token: options.savedToken });
    });
    return app;
  }

  get page(): Page {
    return this.#current.page;
  }

  get context(): BrowserContext {
    return this.#current.context;
  }

  get server(): DiggaServer {
    return this.#current.server;
  }

  get api(): AppApiClient {
    return this.#current.api;
  }

  get origin(): string {
    return this.server.origin;
  }

  async open(hash = "#/triage"): Promise<void> {
    await this.page.goto(`${this.origin}/${hash}`);
  }

  async relaunch(options: { crash?: boolean } = {}): Promise<void> {
    await this.#stop(options);
    await this.#start(async () => {});
  }

  /**
   * Stops the server and starts a new one on the same port, so the open page and its session
   * stay. It first waits until none of the page's requests is on its way; a request the page
   * sends while no server runs fails, as it would for a user, and the test declares it. Another
   * process can take the port in between, and the restart then fails with that reason instead
   * of moving to another port, where the page could not follow.
   */
  async restartServer(options: { crash?: boolean } = {}): Promise<void> {
    const launch = this.#current;
    const { port } = launch.server;
    await this.log.quiet();
    if (options.crash) await launch.server.crash();
    else await launch.server.stop();
    try {
      const server = await startDiggaServer(this.#options.environment, { port });
      this.servers.push(server);
      this.#launch = { ...launch, server };
    } catch (error) {
      if (String(error).includes("EADDRINUSE"))
        throw new Error(`another process took port ${port} while the server restarted`, {
          cause: error,
        });
      throw error;
    }
  }

  /** The command runs beside the server, on the same library, with the same isolation. */
  async cli(args: string[]): Promise<DiggaRun> {
    return runDigga(args, this.#options.environment);
  }

  async paste(text: string): Promise<void> {
    await this.page.evaluate((pasted) => {
      const data = new DataTransfer();
      data.setData("text/plain", pasted);
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  }

  /**
   * A route registered before the action answers the window's page, so the URL never reaches the
   * network or the guard. The route goes with the window: an external URL opened later is refused
   * and fails the test.
   */
  async expectExternalOpen(action: () => Promise<void>): Promise<string> {
    const { context } = this;
    const opened = Promise.withResolvers<string>();
    const isExternal = (url: URL) => url.origin !== this.origin;
    const answer = async (route: Route) => {
      const request = route.request();
      // Only the window's page is the URL the app opened; what that page asks for gets nothing.
      if (!request.isNavigationRequest()) return route.fulfill({ status: 404 });
      opened.resolve(request.url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    };
    const popup = context.waitForEvent("page");
    // An action that fails leaves the wait to time out unobserved.
    popup.catch(() => {});
    await context.route(isExternal, answer);
    try {
      await action();
      const [url, page] = await Promise.all([opened.promise, popup]);
      await page.close();
      return url;
    } finally {
      await context.unroute(isExternal, answer);
    }
  }

  /**
   * Arms the download event before the action; saveAs() resolves only once the download has
   * completed and the file is written, and a failed download has no file to save.
   */
  async expectDownload(action: () => Promise<void>): Promise<{ name: string; path: string }> {
    const started = this.page.waitForEvent("download");
    // An action that fails leaves the wait to time out unobserved.
    started.catch(() => {});
    await action();
    const download = await started;
    const name = download.suggestedFilename();
    const file = path.join(this.#options.outputDir, "downloads", name);
    await download.saveAs(file);
    return { name, path: file };
  }

  async abortRequests(
    match: RequestMatch,
    options: { times?: number } = {},
  ): Promise<AbortedRequests> {
    return abortRequests(this.context, match, {
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

  /** Stops what is running; a relaunch that failed has left nothing. */
  async close(): Promise<void> {
    if (this.#launch) await this.#stop({});
  }

  /** False after a relaunch that failed, when there is no page to read. */
  get running(): boolean {
    return this.#launch !== null;
  }

  get #current(): Launch {
    if (!this.#launch) throw new Error("the app is not running");
    return this.#launch;
  }

  /** Starts the server, applies the given state, then prepares the context the page opens in. */
  async #start(given: (api: AppApiClient) => Promise<void>): Promise<void> {
    const server = await startDiggaServer(this.#options.environment);
    this.servers.push(server);
    try {
      const api = new AppApiClient(server.port);
      await given(api);
      const { context, page } = await this.#preparePage(server.origin);
      this.#launch = { server, context, page, api };
    } catch (error) {
      await server.crash();
      throw error;
    }
  }

  /** Closes the page first, so none of its requests meets a stopped server. */
  async #stop(options: { crash?: boolean }): Promise<void> {
    const { context, server } = this.#current;
    this.#launch = null;
    await context.close();
    if (options.crash) await server.crash();
    else await server.stop();
  }

  /**
   * A blank page in a context that has everything the app needs before its first script
   * (docs/E2E_TESTING.md, "Startup order").
   */
  async #preparePage(origin: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await this.#options.browser.newContext(CONTEXT_OPTIONS);
    try {
      await guardContext(context, origin, this.log.guard);
      await context.addInitScript(fakeYouTubeScript(videoCatalogue()));
      if (this.#options.clock) await context.clock.install();
      this.log.watch(context);
      return { context, page: await context.newPage() };
    } catch (error) {
      await context.close();
      throw error;
    }
  }
}
