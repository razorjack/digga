import { expect, type Locator } from "@playwright/test";
import type { DiggaApp } from "../support/app.ts";

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

/** What the unsaved settings dialog is answered with. */
export type UnsavedSettingsAnswer = "Save" | "Discard" | "Keep editing";

/** The dialog Settings shows when the user leaves it with unsaved changes. */
export class UnsavedSettingsDialog {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("dialog", { name: "Unsaved settings" });
  }

  button(answer: UnsavedSettingsAnswer): Locator {
    return this.root.getByRole("button", { name: answer, exact: true });
  }

  /** Answers with a button, or Keep editing with Esc; returns once the dialog has closed. */
  async answer(answer: UnsavedSettingsAnswer, by: "click" | "escape" = "click"): Promise<void> {
    await expect(this.root).toBeVisible();
    if (by === "escape") await this.app.page.keyboard.press("Escape");
    else await this.button(answer).click();
    await expect(this.root).toBeHidden();
  }
}
