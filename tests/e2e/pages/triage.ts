import { expect, type Locator, type Response } from "@playwright/test";
import { type TriageStatus, VERDICT_KEYS } from "../../../src/client/keymap.ts";
import type { DiggaApp } from "../support/app.ts";

/** The key the keymap binds to a verdict, as a key press. */
export function verdictKey(status: TriageStatus): string {
  const binding = VERDICT_KEYS.find((verdict) => verdict.status === status);
  if (!binding) throw new Error(`no key judges ${status}`);
  return binding.key.toLowerCase();
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

  /** The record on screen, once one is. */
  async currentKey(): Promise<string> {
    await expect(this.record).toBeVisible();
    const key = await this.record.getAttribute("data-triage-key");
    if (key === null) throw new Error("the record has no triage key");
    return key;
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

  /** N: the record stays undecided and the next one shows. */
  async pass(): Promise<void> {
    const key = await this.currentKey();
    await this.app.page.keyboard.press("n");
    await expect(this.record).not.toHaveAttribute("data-triage-key", key);
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
function isRequest(response: Response, method: string, path: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && decodeURIComponent(url.pathname) === path;
}
