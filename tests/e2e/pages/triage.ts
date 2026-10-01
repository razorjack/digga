import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { TRACK_MARK_KEYS, type TriageStatus, VERDICT_KEYS } from "../../../src/client/keymap.ts";
import { PLAYER_STATUS_COPY, type PlayerStatus } from "../../../src/client/player/status.ts";
import { MARK_COPY } from "../../../src/client/twelves/model.ts";
import type { ListenLogInput, TrackVerdictInput } from "../../../src/shared/api.ts";
import type { TrackMark } from "../../../src/shared/types.ts";
import type { DiggaApp } from "../support/app.ts";

/** Past the session's 1.5 s grace before a wantlist push, for runFor(). */
export const PAST_PUSH_GRACE_MS = 2000;

/** The slip's last word on a push to the Discogs wantlist, whichever way it went. */
const PUSH_ENDED = /Added to your Discogs wantlist\.|Saved, but not on the Discogs wantlist\./;

/** The player logs a listen after 4 s of playback and adds at most 1 s per 250 ms tick. */
export const LOGGED_LISTEN_MS = 4500;

/** The key the keymap binds to a verdict, as a key press. */
export function verdictKey(status: TriageStatus): string {
  const binding = VERDICT_KEYS.find((verdict) => verdict.status === status);
  if (!binding) throw new Error(`no key judges ${status}`);
  return binding.key.toLowerCase();
}

/** The key press that puts a mark on the playing track. */
export function trackMarkKey(mark: TrackMark): string {
  const binding = TRACK_MARK_KEYS.find((candidate) => candidate.mark === mark);
  if (!binding) throw new Error(`no key marks a track ${mark}`);
  return `Shift+${binding.key}`;
}

/**
 * Triage's locators and actions. Each action returns once the work it starts has finished, not at
 * its first visible sign (docs/E2E_TESTING.md, "Synchronisation"); checks stay in the tests.
 */
export class TriagePage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("main");
  }

  get record(): Locator {
    return this.root.locator("header[data-triage-key]");
  }

  get lastAction(): Locator {
    return this.root.getByRole("group", { name: "Last action" });
  }

  get player(): Locator {
    return this.root.getByRole("region", { name: "Player" });
  }

  /** The player's messages, such as a video it skipped. */
  get notices(): Locator {
    return this.player.getByRole("status", { name: "Player notices" });
  }

  /** The slider under the video, at the second the player has reached. */
  get position(): Locator {
    return this.player.getByRole("slider", { name: "Position in the track" });
  }

  /** The record after this one. */
  get upNext(): Locator {
    return this.root.getByRole("group", { name: "Up next" });
  }

  /** The session's messages, such as a verdict that was not saved. */
  get messages(): Locator {
    return this.root.getByRole("status", { name: "Triage messages" });
  }

  get noteField(): Locator {
    return this.root.getByRole("textbox", { name: "Note on this record" });
  }

  /** The verdict's button in the bar under the record; the bar offers M only with a Maybe list. */
  verdictButton(status: TriageStatus): Locator {
    const bar = this.root.getByRole("group", { name: "Verdicts" });
    return bar.locator(`[aria-keyshortcuts="${verdictKey(status).toUpperCase()}"]`);
  }

  /** The record's price, copies for sale and have/want, and when Discogs was asked. */
  get market(): Locator {
    return this.record.getByRole("status");
  }

  /** The strip above the desk while a round of snoozed records or a scope runs. */
  get banner(): Locator {
    return this.root.getByText(/^(Digging|Hearing snoozed records again)/);
  }

  /** F's dialog: the record's labels and artists, the last load's records, and a search. */
  get scopePicker(): Locator {
    return this.app.page.getByRole("dialog", { name: "Dig one label, artist or seller" });
  }

  get scopeSearch(): Locator {
    return this.scopePicker.getByRole("searchbox", { name: "Label, artist or seller" });
  }

  /** What the picker says about its options: their number, a search in progress, no match. */
  get scopeStatus(): Locator {
    return this.scopePicker.getByRole("status");
  }

  /** At the end of the queue, or of a scope, the button that brings back the records passed. */
  get goRoundButton(): Locator {
    return this.root.getByRole("button", { name: /^go round the \d+ you passed$/ });
  }

  /** The player's status line while it reads the status's copy. */
  playerStatus(status: PlayerStatus): Locator {
    return this.player.getByText(PLAYER_STATUS_COPY[status], { exact: true });
  }

  get tracklist(): Locator {
    return this.root.getByRole("list", { name: "Tracklist" });
  }

  track(position: string): Locator {
    return this.tracklist.locator(`[data-position="${position}"]`);
  }

  /** A video under "Other videos", which matches no track. */
  otherVideo(videoId: string): Locator {
    return this.tracklist.locator(`[data-video-id="${videoId}"]`);
  }

  /** The row of the track or video the player is on: its button is the current one. */
  get currentTrack(): Locator {
    const current = this.app.page.locator('[aria-current="true"]');
    return this.tracklist.getByRole("listitem").filter({ has: current });
  }

  /** The mark's stamp on a track row. */
  trackMark(position: string, mark: TrackMark): Locator {
    return this.track(position).getByText(MARK_COPY[mark], { exact: true });
  }

  /** The record on screen, once one is. */
  async currentKey(): Promise<string> {
    await expect(this.record).toBeVisible();
    const key = await this.record.getAttribute("data-triage-key");
    if (key === null) throw new Error("the record has no triage key");
    return key;
  }

  /** Space on a record that waits for it; returns once the player plays. */
  async startListening(): Promise<void> {
    await expect(this.playerStatus("needs_gesture")).toBeVisible();
    await this.app.page.keyboard.press("Space");
    await expect(this.playerStatus("playing")).toBeVisible();
  }

  /** Space while the player plays; returns once it has paused. */
  async pause(): Promise<void> {
    await this.#pressSpace("playing", "paused");
  }

  /** Space while the player is paused; returns once it plays again. */
  async resume(): Promise<void> {
    await this.#pressSpace("paused", "playing");
  }

  /** J; returns the position of the track it moved to, once that track plays. */
  async nextTrack(): Promise<string> {
    return this.#changeTrack("j");
  }

  /** K; returns the position of the track it moved to, once that track plays. */
  async previousTrack(): Promise<string> {
    return this.#changeTrack("k");
  }

  /**
   * Lets the page's clock run while the player plays, at least the 4 s after which it logs a
   * listen; returns that listen once the server has saved it.
   */
  async listenFor(ms = LOGGED_LISTEN_MS): Promise<ListenLogInput> {
    await expect(this.playerStatus("playing")).toBeVisible();
    return this.listenLoggedBy(() => this.app.clock.runFor(ms));
  }

  /** Runs the action; returns the listen it made the player log, once the server has saved it. */
  async listenLoggedBy(action: () => Promise<void>): Promise<ListenLogInput> {
    const logged = this.#response("POST", "/api/listen-log");
    await action();
    const response = await logged;
    expect(response.ok(), "POST /api/listen-log").toBe(true);
    await response.finished();
    return response.request().postDataJSON() as ListenLogInput;
  }

  /**
   * Pastes a YouTube link on the page; returns once the server has attached it to the record and
   * the page says so.
   */
  async attachVideo(url: string): Promise<void> {
    const releaseId = await this.record.getAttribute("data-release-id");
    const attached = this.#response("POST", `/api/releases/${releaseId}/videos`);
    await this.app.paste(url);
    const response = await attached;
    expect(response.ok(), `POST /api/releases/${releaseId}/videos`).toBe(true);
    await response.finished();
    await expect(this.messages).toHaveText("Attached to this release; it plays here from now on.");
  }

  /**
   * Presses the verdict's key; returns once the server has saved it and the page has acted. A key
   * pressed before a record is on screen does nothing, so it waits for one first.
   */
  async judge(status: TriageStatus): Promise<void> {
    await expect(this.record).toBeVisible();
    const saved = this.#response("POST", "/api/verdicts");
    await this.app.page.keyboard.press(verdictKey(status));
    await this.#settled(await saved);
  }

  /**
   * Holds the verdict's key down until it repeats, then lets go; returns once the verdict of the
   * first press is saved and the key is up.
   */
  async holdVerdictKey(status: TriageStatus): Promise<void> {
    await expect(this.record).toBeVisible();
    const saved = this.#response("POST", "/api/verdicts");
    await this.app.page.keyboard.down(verdictKey(status));
    await this.#settled(await saved);
    // A key that is down already sends a keydown with repeat set, as a held key does.
    await this.app.page.keyboard.down(verdictKey(status));
    await this.app.page.keyboard.up(verdictKey(status));
  }

  /** The sandbox sends no verdict request: returns once the record has changed and the slip settled. */
  async judgeInSandbox(status: TriageStatus): Promise<void> {
    const key = await this.currentKey();
    await this.app.page.keyboard.press(verdictKey(status));
    await expect(this.record).not.toHaveAttribute("data-triage-key", key);
    await expect(this.lastAction).not.toHaveAttribute("aria-busy", "true");
  }

  /**
   * A or C with time flowing: returns once the server has answered the push, which it does after
   * its call to Discogs, and the slip shows how the push ended.
   */
  async judgeAndPush(status: "accepted" | "candidate"): Promise<Response> {
    const releaseId = await this.record.getAttribute("data-release-id");
    const pushed = this.#response("POST", `/api/discogs/wantlist/${releaseId}`);
    await this.judge(status);
    const response = await pushed;
    await response.finished();
    await expect(this.lastAction).toContainText(PUSH_ENDED);
    return response;
  }

  /** N: the record stays undecided and the next one shows. */
  async pass(): Promise<void> {
    const key = await this.currentKey();
    await this.app.page.keyboard.press("n");
    await expect(this.record).not.toHaveAttribute("data-triage-key", key);
  }

  /** N at the end of the queue: the records passed come round again. */
  async goRound(): Promise<void> {
    await expect(this.goRoundButton).toBeVisible();
    await this.app.page.keyboard.press("n");
    await expect(this.record).toBeVisible();
  }

  /** The end of the queue's button: returns once the snoozed records have loaded as a round. */
  async hearSnoozed(): Promise<void> {
    const loaded = this.#response("GET", "/api/twelves");
    await this.root.getByRole("button", { name: /^hear the \d+ snoozed again$/ }).click();
    await this.#completed(await loaded);
    await expect(this.banner).toContainText("Hearing snoozed records again");
  }

  /** Esc in a round of snoozed records: the queue is back where it was, without the banner. */
  async leaveRound(): Promise<void> {
    await expect(this.banner).toBeVisible();
    await this.app.page.keyboard.press("Escape");
    await expect(this.banner).toBeHidden();
  }

  /** F: returns once the picker is open with its search field focused. */
  async openScopePicker(): Promise<void> {
    await expect(this.record).toBeVisible();
    await this.app.page.keyboard.press("f");
    await expect(this.scopeSearch).toBeFocused();
  }

  /** Types into the picker's search; returns once the server has answered and the page shows it. */
  async searchScopes(text: string): Promise<void> {
    const searched = this.app.page.waitForResponse(
      (response) =>
        isRequest(response, "GET", "/api/scopes") &&
        new URL(response.url()).searchParams.get("q") === text,
    );
    await this.scopeSearch.fill(text);
    await this.#completed(await searched);
    await expect(this.scopeStatus).not.toHaveText("Searching…");
  }

  /** Enter in the picker: returns once the queue of the chosen scope has loaded. */
  async digScope(): Promise<void> {
    await expect(this.scopePicker).toBeVisible();
    const loaded = this.#queueLoaded((scope) => scope !== null);
    await this.app.page.keyboard.press("Enter");
    await this.#completed(await loaded);
    await expect(this.scopePicker).toBeHidden();
  }

  /** Esc in the picker: it closes and the queue stays as it was. */
  async closeScopePicker(): Promise<void> {
    await expect(this.scopePicker).toBeVisible();
    await this.app.page.keyboard.press("Escape");
    await expect(this.scopePicker).toBeHidden();
  }

  /** Esc while a scope runs: returns once the whole queue has loaded again. */
  async leaveScope(): Promise<void> {
    await expect(this.banner).toBeVisible();
    const loaded = this.#queueLoaded((scope) => scope === null);
    await this.app.page.keyboard.press("Escape");
    await this.#completed(await loaded);
    await expect(this.banner).toBeHidden();
  }

  /** P: returns once the server has the release's market data and the line shows it. */
  async askMarket(): Promise<void> {
    const releaseId = await this.record.getAttribute("data-release-id");
    const asked = this.#response("POST", `/api/releases/${releaseId}/enrich`);
    await this.app.page.keyboard.press("p");
    await this.#completed(await asked);
    await expect(this.market).toHaveAttribute("aria-busy", "false");
    await expect(this.market).toContainText("checked");
  }

  /** O: returns the address the app opened, the release on discogs.com. */
  async openOnDiscogs(): Promise<string> {
    await expect(this.record).toBeVisible();
    return this.app.expectExternalOpen(() => this.app.page.keyboard.press("o"));
  }

  /** S: returns the address the app opened, a YouTube search for the record. */
  async searchYouTube(): Promise<string> {
    await expect(this.record).toBeVisible();
    return this.app.expectExternalOpen(() => this.app.page.keyboard.press("s"));
  }

  /** Enter after the tracklist failed to load: returns once it has loaded and shows. */
  async retryTracklist(): Promise<void> {
    await expect(this.root.getByText(/^The tracklist did not load/)).toBeVisible();
    const releaseId = await this.record.getAttribute("data-release-id");
    const loaded = this.#response("GET", `/api/releases/${releaseId}`);
    await this.app.page.keyboard.press("Enter");
    await this.#completed(await loaded);
    await expect(this.tracklist).toBeVisible();
  }

  /** E: returns once the note field has focus. */
  async openNote(): Promise<void> {
    await expect(this.record).toBeVisible();
    await this.app.page.keyboard.press("e");
    await expect(this.noteField).toBeFocused();
  }

  /** E, the text and Enter: the record shows the note, which its verdict will save. */
  async writeNote(text: string): Promise<void> {
    await this.openNote();
    await this.app.page.keyboard.type(text);
    await this.app.page.keyboard.press("Enter");
    await expect(this.noteField).toBeHidden();
    await expect(this.root.getByText(text, { exact: true })).toBeVisible();
  }

  /** Esc in the note field: returns once the field has closed. */
  async cancelNote(): Promise<void> {
    await expect(this.noteField).toBeFocused();
    await this.app.page.keyboard.press("Escape");
    await expect(this.noteField).toBeHidden();
  }

  /**
   * The mark's key on the playing track, which sets the mark, or clears it when the track has it;
   * returns what was saved, once the server has saved it. The stamp shows before the request.
   */
  async markTrack(mark: TrackMark): Promise<TrackVerdictInput> {
    await expect(this.playerStatus("playing")).toBeVisible();
    const saved = this.#response("POST", "/api/track-verdicts");
    await this.app.page.keyboard.press(trackMarkKey(mark));
    const response = await saved;
    expect(response.ok(), "POST /api/track-verdicts").toBe(true);
    await response.finished();
    return response.request().postDataJSON() as TrackVerdictInput;
  }

  /** The sandbox keeps the mark in the tab: returns once the track shows it. */
  async markTrackInSandbox(mark: TrackMark, position: string): Promise<void> {
    await expect(this.playerStatus("playing")).toBeVisible();
    await this.app.page.keyboard.press(trackMarkKey(mark));
    await expect(this.trackMark(position, mark)).toBeVisible();
  }

  /** X: once the filters are saved and the queue has reloaded without the label. */
  async hideLabel(): Promise<void> {
    await this.#pressAndReload("x");
  }

  /** Z on a verdict: once the server has forgotten it and the page has acted. */
  async undoVerdict(key: string): Promise<void> {
    const forgotten = this.#response("DELETE", `/api/verdicts/${key}`);
    await this.app.page.keyboard.press("z");
    await this.#settled(await forgotten);
  }

  /** Z on a pass, which writes nothing: the record comes back. */
  async undoPass(key: string): Promise<void> {
    await this.app.page.keyboard.press("z");
    await expect(this.record).toHaveAttribute("data-triage-key", key);
  }

  /** Z on a hidden label: once the filters are saved and the queue has reloaded with it. */
  async undoLabel(): Promise<void> {
    await this.#pressAndReload("z");
  }

  async #pressSpace(from: PlayerStatus, to: PlayerStatus): Promise<void> {
    await expect(this.playerStatus(from)).toBeVisible();
    await this.app.page.keyboard.press("Space");
    await expect(this.playerStatus(to)).toBeVisible();
  }

  /**
   * The current row and the status change in the same update, so once another row is current,
   * "playing" is the new track's.
   */
  async #changeTrack(key: "j" | "k"): Promise<string> {
    const before = await this.#currentPosition();
    await this.app.page.keyboard.press(key);
    await expect.poll(() => this.#currentPosition()).not.toBe(before);
    await expect(this.playerStatus("playing")).toBeVisible();
    const position = await this.#currentPosition();
    if (position === null) throw new Error(`${key.toUpperCase()} moved to a video without a track`);
    return position;
  }

  /** The current track's position; null when no track row is current. Never waits. */
  async #currentPosition(): Promise<string | null> {
    const positions = await this.currentTrack.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-position")),
    );
    return positions[0] ?? null;
  }

  async #pressAndReload(key: string): Promise<void> {
    await expect(this.record).toBeVisible();
    const { first: settings, next: queue } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "PUT", "/api/settings"),
      (response) => isRequest(response, "GET", "/api/queue"),
    );
    await this.app.page.keyboard.press(key);
    await (await settings).finished();
    await (await queue).finished();
  }

  /** The queue's next answer whose scope, "label:110" or null for none, passes the test. */
  #queueLoaded(test: (scope: string | null) => boolean): Promise<Response> {
    return this.app.page.waitForResponse(
      (response) =>
        isRequest(response, "GET", "/api/queue") &&
        test(new URL(response.url()).searchParams.get("scope")),
    );
  }

  /** Waits for the app's response to the request an action causes; arm it before the action. */
  #response(method: string, path: string): Promise<Response> {
    return this.app.page.waitForResponse((response) => isRequest(response, method, path));
  }

  /** The body has arrived and the slip is no longer busy: the page has acted on the answer. */
  async #settled(response: Response): Promise<void> {
    await this.#completed(response);
    await expect(this.lastAction).not.toHaveAttribute("aria-busy", "true");
  }

  /** The request succeeded and its whole body has arrived, so the page can act on it. */
  async #completed(response: Response): Promise<void> {
    expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
    await response.finished();
  }
}

/**
 * Waits for a response, and for the first response after it that passes the second test. The
 * first test notes its match itself: Playwright runs the predicates in the order the responses
 * arrive, while a callback chained to the first wait can run after both responses have been
 * dispatched, when they arrive together, and the second wait would then miss its response.
 */
export function waitForResponses(
  page: Page,
  first: (response: Response) => boolean,
  next: (response: Response) => boolean,
): { first: Promise<Response>; next: Promise<Response> } {
  let seen = false;
  const waitForFirst = page.waitForResponse((response) => {
    if (!first(response)) return false;
    seen = true;
    return true;
  });
  return {
    first: waitForFirst,
    next: page.waitForResponse((response) => seen && next(response)),
  };
}

/** Matches the decoded path: the undo's request is /api/verdicts/m%3A601 on the wire. */
export function isRequest(response: Response, method: string, path: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && decodeURIComponent(url.pathname) === path;
}
