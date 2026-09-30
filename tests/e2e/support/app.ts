import type { Page } from "@playwright/test";
import type { ExpectedProblems } from "./browser-log.ts";
import type { RequestMatch } from "./fault-routes.ts";
import type { FakeLoad, FakePlayerSnapshot } from "./fake-youtube.ts";
import type { DiggaLibrary } from "./spawn.ts";

/**
 * What a test gets: the window under test and the app's own API, whichever host runs it
 * (docs/E2E_TESTING.md, "The app host"). The web host implements the part the P0 scenarios
 * need, apart from the first-run setup.
 */
export interface DiggaApp {
  /** The window under test. A relaunch replaces it; page objects read it on each use. */
  readonly page: Page;
  /** http://localhost:<port>, fixed for one launch. */
  readonly origin: string;
  readonly library: DiggaLibrary;
  /** Calls to the current launch's /api, for given state and read-back. */
  readonly api: AppApiClient;
  readonly youtube: FakeYouTubeHandle;
  readonly clock: PageClock;
  /** Opens a hash route such as "#/twelves"; defaults to "#/triage". */
  open(hash?: string): Promise<void>;
  /**
   * Stops the whole app and starts it again on the same library, prepared as at the first
   * launch, with a new page that is blank until open(). Given state is not applied again.
   */
  relaunch(options?: { crash?: boolean }): Promise<void>;
  /** Dispatches a paste event carrying the text at the focused element. */
  paste(text: string): Promise<void>;
  /** The page's /api requests so far, over every launch, as "METHOD /api/path". */
  apiRequests(): string[];
  /** Aborts the page's next matching requests (one by default), for the current launch. */
  abortRequests(match: RequestMatch, options?: { times?: number }): Promise<void>;
  /** Declares problems the test causes on purpose, so the fixture does not fail it for them. */
  expectProblems(problems: ExpectedProblems): void;
}

/** Typed calls to the app's own /api, for given state and read-back; never another origin. */
export class AppApiClient {
  readonly #base: string;

  constructor(port: number) {
    this.#base = `http://127.0.0.1:${port}`;
  }

  get<Result>(path: string): Promise<Result> {
    return this.#request<Result>("GET", path);
  }

  send<Result>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Result> {
    return this.#request<Result>(method, path, body);
  }

  async #request<Result>(method: string, path: string, body?: unknown): Promise<Result> {
    if (!path.startsWith("/api/")) throw new Error(`${path} is not one of the app's /api paths`);
    const response = await fetch(`${this.#base}${path}`, {
      method,
      redirect: "error",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as Result;
  }
}

/** Reads and drives window.__fakeYouTube in the page. */
export class FakeYouTubeHandle {
  readonly #page: () => Page;

  constructor(page: () => Page) {
    this.#page = page;
  }

  players(): Promise<FakePlayerSnapshot[]> {
    return this.#page().evaluate(() => window.__fakeYouTube!.players());
  }

  audible(): Promise<string | null> {
    return this.#page().evaluate(() => window.__fakeYouTube!.audible());
  }

  loads(): Promise<FakeLoad[]> {
    return this.#page().evaluate(() => window.__fakeYouTube!.loads());
  }

  hasActivation(): Promise<boolean> {
    return this.#page().evaluate(() => navigator.userActivation.hasBeenActive);
  }
}

/**
 * pause() reads the page's time and pauses the clock this far ahead of it, since the page's time
 * runs on while the calls travel and pauseAt() refuses a time in the past. The clock jumps by what
 * is left of the lead, firing each timer due in it at most once, so a test pauses before the
 * action whose window it protects.
 */
const PAUSE_LEAD_MS = 1000;

/**
 * Playwright's clock in the current page (docs/E2E_TESTING.md, "Time"). The host installs it before
 * the app starts when the test asks for it; time then flows, so polling runs, until pause().
 */
export class PageClock {
  readonly #page: () => Page;
  readonly #installed: boolean;

  constructor(page: () => Page, installed: boolean) {
    this.#page = page;
    this.#installed = installed;
  }

  /** Stops the page's time; from then on timers fire only through runFor(). */
  async pause(): Promise<void> {
    const page = this.#installedPage();
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + PAUSE_LEAD_MS);
  }

  /** Lets the time pass, firing every due timer in order, repeating ones included. */
  async runFor(ms: number): Promise<void> {
    await this.#installedPage().clock.runFor(ms);
  }

  /** A clock installed after the app started would miss the timers it had set already. */
  #installedPage(): Page {
    if (!this.#installed)
      throw new Error("the test did not ask for the clock (diggaOptions.clock)");
    return this.#page();
  }
}
