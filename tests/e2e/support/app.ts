import type { Page } from "@playwright/test";
import type { DiggaLibrary } from "./spawn.ts";
import type { FakeLoad, FakePlayerSnapshot } from "./fake-youtube.ts";

/**
 * What a test gets: the window under test and the app's own API, whichever host runs it
 * (docs/E2E_TESTING.md, "The app host"). The spike implements the web host's part that GUARD-01,
 * SHELL-01, TRI-07 and TRI-10 need.
 */
export interface DiggaApp {
  /** The window under test; page objects read it on each use. */
  readonly page: Page;
  /** http://localhost:<port>, fixed for one launch. */
  readonly origin: string;
  readonly library: DiggaLibrary;
  readonly api: AppApiClient;
  readonly youtube: FakeYouTubeHandle;
  /** Opens a hash route such as "#/twelves"; defaults to "#/triage". */
  open(hash?: string): Promise<void>;
  /** Dispatches a paste event carrying the text at the focused element. */
  paste(text: string): Promise<void>;
  /** Declares an /api response of 400 or above that the test causes on purpose. */
  allowApiError(pattern: RegExp): void;
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
