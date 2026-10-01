import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { videoCatalogue } from "../../fixtures/catalogue.ts";
import { AppApiClient, type DiggaApp, FakeYouTubeHandle, Given, PageClock } from "../app.ts";
import { guardContext } from "../browser-guard.ts";
import { BrowserLog, type ExpectedProblems } from "../browser-log.ts";
import { abortRequests, type RequestMatch } from "../fault-routes.ts";
import { fakeYouTubeScript } from "../fake-youtube.ts";
import {
  type DiggaEnvironment,
  type DiggaLibrary,
  type DiggaServer,
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

  async abortRequests(match: RequestMatch, options: { times?: number } = {}): Promise<void> {
    await abortRequests(this.context, match, {
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
