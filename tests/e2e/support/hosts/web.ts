import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { videoCatalogue } from "../../fixtures/catalogue.ts";
import { AppApiClient, type DiggaApp, FakeYouTubeHandle } from "../app.ts";
import { type BrowserGuardLog, emptyGuardLog, guardContext } from "../browser-guard.ts";
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
  /** Saved through PUT /api/discogs/token before the page opens. */
  savedToken: string | null;
}

/** The browser app: the CLI's server in its own process, and a prepared Chromium context. */
export class WebApp implements DiggaApp {
  readonly server: DiggaServer;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly library: DiggaLibrary;
  readonly api: AppApiClient;
  readonly youtube: FakeYouTubeHandle;
  readonly guardLog: BrowserGuardLog = emptyGuardLog();
  /** The page's /api requests, as "METHOD /api/path", for negative checks. */
  readonly apiRequests: string[] = [];
  readonly #consoleErrors: string[] = [];
  readonly #pageErrors: string[] = [];
  readonly #apiErrors: string[] = [];
  readonly #allowedApiErrors: RegExp[] = [];

  private constructor(
    server: DiggaServer,
    context: BrowserContext,
    page: Page,
    library: DiggaLibrary,
  ) {
    this.server = server;
    this.context = context;
    this.page = page;
    this.library = library;
    this.api = new AppApiClient(server.port);
    this.youtube = new FakeYouTubeHandle(() => this.page);
  }

  static async launch(options: WebAppOptions): Promise<WebApp> {
    const server = await startDiggaServer(options.environment);
    try {
      const api = new AppApiClient(server.port);
      if (options.savedToken)
        await api.send("PUT", "/api/discogs/token", { token: options.savedToken });
      const context = await options.browser.newContext(CONTEXT_OPTIONS);
      const app = new WebApp(server, context, await context.newPage(), options.environment.library);
      await app.#prepareContext();
      return app;
    } catch (error) {
      await server.crash();
      throw error;
    }
  }

  get origin(): string {
    return this.server.origin;
  }

  async open(hash = "#/triage"): Promise<void> {
    await this.page.goto(`${this.origin}/${hash}`);
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

  allowApiError(pattern: RegExp): void {
    this.#allowedApiErrors.push(pattern);
  }

  /** What went wrong that the test did not declare; the fixture fails the test on any. */
  problems(): string[] {
    const { refused, redirects, webSockets } = this.guardLog;
    return [
      ...refused.map((url) => `the browser requested ${url}`),
      ...redirects.map((hop) => `the app redirected ${hop}`),
      ...webSockets.map((url) => `the browser opened a WebSocket to ${url}`),
      ...this.#apiErrors.filter(
        (error) => !this.#allowedApiErrors.some((pattern) => pattern.test(error)),
      ),
      ...this.#pageErrors.map((error) => `page error: ${error}`),
      ...this.#consoleErrors.map((message) => `console error: ${message}`),
    ];
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.server.stop();
  }

  async #prepareContext(): Promise<void> {
    await guardContext(this.context, this.origin, this.guardLog);
    await this.context.addInitScript(fakeYouTubeScript(videoCatalogue()));
    this.context.on("weberror", (error) => this.#pageErrors.push(String(error.error())));
    this.context.on("console", (message) => {
      if (message.type() !== "error") return;
      // Failed responses are logged here too; the API and guard checks decide about those.
      if (message.text().startsWith("Failed to load resource")) return;
      this.#consoleErrors.push(`${message.text()} (${message.location().url})`);
    });
    this.context.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/api/")) this.apiRequests.push(`${request.method()} ${pathname}`);
    });
    this.context.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith("/api/") && response.status() >= 400)
        this.#apiErrors.push(
          `${response.request().method()} ${pathname} answered ${response.status()}`,
        );
    });
  }
}
