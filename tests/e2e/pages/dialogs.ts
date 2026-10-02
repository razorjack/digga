import { expect, type Locator } from "@playwright/test";
import type { Config } from "../../../src/shared/config.ts";
import type { DiggaApp } from "../support/app.ts";
import { isRequest, waitForResponses } from "./triage.ts";

/** How the Keys dialog closes: `?` again, Esc, its close button, or a click on the backdrop. */
export type KeysDialogClose = "help key" | "escape" | "close button" | "backdrop";

/**
 * The Keys dialog that `?` opens on every page. Its actions return once the dialog is open, or
 * once it has closed and the app has handled its close event, so page keys work again.
 */
export class KeysDialog {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("dialog", { name: "Keys" });
  }

  get closeButton(): Locator {
    return this.root.getByRole("button", { name: "close" });
  }

  /** The titles of the key groups the dialog lists, in order. */
  get groupTitles(): Locator {
    return this.root.getByRole("heading", { level: 3 });
  }

  /** `?`; returns once the dialog is open. */
  async open(): Promise<void> {
    await expect(this.root).toBeHidden();
    await this.app.page.keyboard.press("?");
    await expect(this.root).toBeVisible();
  }

  async close(by: KeysDialogClose): Promise<void> {
    await expect(this.root).toBeVisible();
    // The app learns of the close from the dialog's close event, which the browser queues after
    // hiding the dialog; the app's listener was added first, so it has run when this one runs.
    // The listener is in place before the press: a hidden dialog no longer matches the locator.
    const closing = await this.root.evaluateHandle((dialog) => ({
      closed: new Promise<void>((resolve) =>
        dialog.addEventListener("close", () => resolve(), { once: true }),
      ),
    }));
    await this.#press(by);
    await closing.evaluate((listener) => listener.closed);
    await closing.dispose();
    await expect(this.root).toBeHidden();
  }

  async #press(by: KeysDialogClose): Promise<void> {
    if (by === "help key") return this.app.page.keyboard.press("?");
    if (by === "escape") return this.app.page.keyboard.press("Escape");
    if (by === "close button") return this.closeButton.click();
    // The panel is centred and narrower than the window, so its top left corner is backdrop.
    await this.app.page.mouse.click(5, 5);
  }
}

/**
 * The card that ends a practice round in Triage, after five verdicts or Esc. Its Enter leaves
 * the sandbox; the queue then starts again without the practice verdicts.
 */
export class PracticeCard {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("dialog", { name: "That's digging." });
  }

  /** Enter: returns once the sandbox is off and Triage has read its queue again in live mode. */
  async digForReal(): Promise<void> {
    await expect(this.root.getByRole("button", { name: "Dig for real" })).toBeFocused();
    const { first: saved, next: queue } = waitForResponses(
      this.app.page,
      (response) =>
        isRequest(response, "PUT", "/api/settings") &&
        (response.request().postDataJSON() as Config).sandbox === false,
      (response) => isRequest(response, "GET", "/api/queue"),
    );
    await this.app.page.keyboard.press("Enter");
    for (const pending of [saved, queue]) {
      const response = await pending;
      expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
      await response.finished();
    }
    await expect(this.root).toBeHidden();
  }
}
