import { expect, type Locator, type Response } from "@playwright/test";
import { TRACK_MARK_KEYS, type TriageStatus, VERDICT_KEYS } from "../../../src/client/keymap.ts";
import { PLAYER_STATUS_COPY, type PlayerStatus } from "../../../src/client/player/status.ts";
import { MARK_COPY } from "../../../src/client/twelves/model.ts";
import type { TrackMark } from "../../../src/shared/types.ts";
import type { DiggaApp } from "../support/app.ts";

/** Past the session's 1.5 s grace before a wantlist push, for runFor(). */
export const PAST_PUSH_GRACE_MS = 2000;

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

  /** The session's messages, such as a verdict that was not saved. */
  get messages(): Locator {
    return this.root.getByRole("status", { name: "Triage messages" });
  }

  get noteField(): Locator {
    return this.root.getByRole("textbox", { name: "Note on this record" });
  }

  /** The player's status line while it reads the status's copy. */
  playerStatus(status: PlayerStatus): Locator {
    return this.player.getByText(PLAYER_STATUS_COPY[status], { exact: true });
  }

  track(position: string): Locator {
    return this.root
      .getByRole("list", { name: "Tracklist" })
      .locator(`[data-position="${position}"]`);
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

  /** The sandbox sends no verdict request: returns once the record has changed and the slip settled. */
  async judgeInSandbox(status: TriageStatus): Promise<void> {
    const key = await this.currentKey();
    await this.app.page.keyboard.press(verdictKey(status));
    await expect(this.record).not.toHaveAttribute("data-triage-key", key);
    await expect(this.lastAction).not.toHaveAttribute("aria-busy", "true");
  }

  /** N: the record stays undecided and the next one shows. */
  async pass(): Promise<void> {
    const key = await this.currentKey();
    await this.app.page.keyboard.press("n");
    await expect(this.record).not.toHaveAttribute("data-triage-key", key);
  }

  /** E, the text and Enter: the record shows the note, which its verdict will save. */
  async writeNote(text: string): Promise<void> {
    await expect(this.record).toBeVisible();
    await this.app.page.keyboard.press("e");
    await expect(this.noteField).toBeFocused();
    await this.app.page.keyboard.type(text);
    await this.app.page.keyboard.press("Enter");
    await expect(this.noteField).toBeHidden();
    await expect(this.root.getByText(text, { exact: true })).toBeVisible();
  }

  /** Marks the playing track; returns once the server has saved the mark. */
  async markTrack(mark: TrackMark): Promise<void> {
    await expect(this.playerStatus("playing")).toBeVisible();
    const saved = this.#response("POST", "/api/track-verdicts");
    await this.app.page.keyboard.press(trackMarkKey(mark));
    const response = await saved;
    expect(response.ok(), "POST /api/track-verdicts").toBe(true);
    await response.finished();
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

  async #pressAndReload(key: string): Promise<void> {
    await expect(this.record).toBeVisible();
    let saved = false;
    const settings = this.#response("PUT", "/api/settings").then((response) => {
      saved = true;
      return response;
    });
    const queue = this.app.page.waitForResponse(
      (response) => saved && isRequest(response, "GET", "/api/queue"),
    );
    await this.app.page.keyboard.press(key);
    await (await settings).finished();
    await (await queue).finished();
  }

  /** Waits for the app's response to the request an action causes; arm it before the action. */
  #response(method: string, path: string): Promise<Response> {
    return this.app.page.waitForResponse((response) => isRequest(response, method, path));
  }

  /** The body has arrived and the slip is no longer busy: the page has acted on the answer. */
  async #settled(response: Response): Promise<void> {
    expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
    await response.finished();
    await expect(this.lastAction).not.toHaveAttribute("aria-busy", "true");
  }
}

/** Matches the decoded path: the undo's request is /api/verdicts/m%3A601 on the wire. */
export function isRequest(response: Response, method: string, path: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && decodeURIComponent(url.pathname) === path;
}
