import { expect, type Page } from "@playwright/test";
import type {
  ListenLogInput,
  ReleaseDetail,
  TrackVerdictInput,
  VerdictInput,
} from "../../../src/shared/api.ts";
import { tuneSnapshot } from "../../../src/shared/track-identity.ts";
import type { Job } from "../../../src/shared/types.ts";
import type { ExpectedProblems } from "./browser-log.ts";
import type { AbortedRequests, RequestMatch } from "./fault-routes.ts";
import type { FakeLoad, FakePlayerSnapshot } from "./fake-youtube.ts";
import type { DiggaLibrary, DiggaRun } from "./spawn.ts";

/**
 * What a test gets: the window under test and the app's own API, whichever host runs it
 * (docs/e2e/HARNESS.md#the-app-host). The web host implements all of it; the Electron host
 * will not have restartServer().
 */
export interface DiggaApp {
  /** The window under test. A relaunch replaces it; page objects read it on each use. */
  readonly page: Page;
  /** http://localhost:<port>, fixed for one launch. */
  readonly origin: string;
  /** The library the app runs on; a relaunch may move it to another (newLibrary). */
  readonly library: DiggaLibrary;
  /** Calls to the current launch's /api, for given state and read-back. */
  readonly api: AppApiClient;
  /** Given state, written through the app's own /api before the page opens. */
  readonly given: Given;
  readonly youtube: FakeYouTubeHandle;
  readonly clock: PageClock;
  /** Opens a hash route such as "#/twelves"; defaults to "#/triage". */
  open(hash?: string): Promise<void>;
  /**
   * Stops the whole app and starts it again on the same library, or on the one given, prepared
   * as at the first launch, with a new page that is blank until open(). Given state is not
   * applied again.
   */
  relaunch(options?: { crash?: boolean; library?: DiggaLibrary }): Promise<void>;
  /**
   * Web only: stops the server and starts it again on the same port, while the page and its
   * session stay. The page's requests while it is down fail. Fails, rather than moving to another
   * port, when another process has taken the port meanwhile.
   */
  restartServer(options?: { crash?: boolean }): Promise<void>;
  /**
   * Runs `digga <args>` against the app's library, or the one given, with the same isolation,
   * and waits for its exit.
   */
  cli(args: string[], options?: { library?: DiggaLibrary }): Promise<DiggaRun>;
  /** Dispatches a paste event carrying the text at the focused element. */
  paste(text: string): Promise<void>;
  /**
   * Runs the action and returns the external URL it opened in a new window, which gets an empty
   * page instead of the site; the window is closed again. Outside this helper the guard refuses
   * an external URL and fails the test.
   */
  expectExternalOpen(action: () => Promise<void>): Promise<string>;
  /**
   * Runs the action and returns the file it downloaded, once the download has completed and the
   * file is saved in the test's output folder.
   */
  expectDownload(action: () => Promise<void>): Promise<{ name: string; path: string }>;
  /** The page's /api requests so far, over every launch, as "METHOD /api/path". */
  apiRequests(): string[];
  /**
   * Aborts the page's next matching requests (one by default), for the current launch; with
   * `times: Infinity`, every one until the test lifts them.
   */
  abortRequests(match: RequestMatch, options?: { times?: number }): Promise<AbortedRequests>;
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

/**
 * Decisions a test starts from, written through the app's own /api as the page would write them,
 * before the page opens (docs/e2e/FIXTURES.md#libraries).
 */
export class Given {
  readonly #api: () => AppApiClient;

  constructor(api: () => AppApiClient) {
    this.#api = api;
  }

  /** A logged listen: the tune reads heard on every release that has it. */
  async listen(input: ListenLogInput): Promise<void> {
    await this.#api().send("POST", "/api/listen-log", input);
  }

  /** A verdict as Triage saves one; `decidedAt` dates it, else it is dated now. */
  async verdict(input: VerdictInput): Promise<void> {
    await this.#api().send("POST", "/api/verdicts", input);
  }

  /** A note on a release, as `E` saves one. */
  async note(releaseId: number, notes: string): Promise<void> {
    await this.#api().send("PUT", `/api/releases/${releaseId}/note`, { notes });
  }

  /** Verdicts saved one after the other, in the list's order. */
  async verdicts(inputs: VerdictInput[]): Promise<void> {
    for (const input of inputs) await this.verdict(input);
  }

  /** A track mark as Triage saves one, on the tune the release lists at the position. */
  async trackMark(input: Omit<TrackVerdictInput, "tune">): Promise<void> {
    const release = await this.#api().get<ReleaseDetail>(`/api/releases/${input.releaseId}`);
    const track = release.tracks.find((candidate) => candidate.position === input.position);
    if (!track) throw new Error(`release ${input.releaseId} lists no track at ${input.position}`);
    const tune = tuneSnapshot(track);
    await this.#api().send("POST", "/api/track-verdicts", { ...input, tune });
  }

  /** Reads a seller's shop through the job Settings' "Read shop" starts; returns once it is done. */
  async sellerShop(username: string): Promise<void> {
    const started = await this.#api().send<Job>("POST", "/api/jobs/import/seller", { username });
    let job = started;
    await expect
      .poll(async () => {
        job = await this.#api().get<Job>(`/api/jobs/${started.id}`);
        return job.status;
      }, `reading ${username}'s shop`)
      .not.toMatch(/^(queued|running)$/);
    if (job.status !== "done")
      throw new Error(`reading ${username}'s shop ended ${job.status}: ${job.error ?? ""}`);
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

  /** Plays the audible video to its end, which fires the player's ENDED state at once. */
  async end(): Promise<void> {
    await this.#page().evaluate(() => window.__fakeYouTube!.end());
  }

  /** Refuses the video from now on, with YouTube's error code, also on players holding it. */
  async fail(videoId: string, code: number): Promise<void> {
    await this.#page().evaluate(([id, error]) => window.__fakeYouTube!.fail(id, error), [
      videoId,
      code,
    ] as const);
  }

  /** Keeps playback with sound unstarted from now on, as a browser that blocks autoplay does. */
  async blockSound(): Promise<void> {
    await this.#page().evaluate(() => window.__fakeYouTube!.blockSound());
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
 * Playwright's clock in the current page (docs/e2e/AUTHORING.md#time). The host installs it before
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
