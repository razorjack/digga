import { expect, type Locator } from "@playwright/test";
import { type ShelfId, SHELVES } from "../../../src/client/twelves/model.ts";
import type { DiggaApp } from "../support/app.ts";

/** Twelves' shelves, as far as the scenarios read them. */
export class TwelvesPage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("main");
  }

  /** The shelf's rows: a table captioned with the shelf's name, or "Marked tracks" on Tracks. */
  shelf(id: ShelfId): Locator {
    const name = id === "tracks" ? "Marked tracks" : shelfOf(id).label;
    return this.root.getByRole("table", { name });
  }

  /** The row of a shelf that shows the text, such as a release's title. */
  row(id: ShelfId, text: string): Locator {
    return this.shelf(id).getByRole("row").filter({ hasText: text });
  }

  /** The shelf's key; returns once the shelf is the chosen one. */
  async showShelf(id: ShelfId): Promise<void> {
    const shelf = shelfOf(id);
    const option = this.root.getByRole("radio", { name: new RegExp(`^${shelf.label}\\b`) });
    await expect(option).toBeVisible();
    await this.app.page.keyboard.press(String(SHELVES.indexOf(shelf) + 1));
    await expect(option).toBeChecked();
  }
}

function shelfOf(id: ShelfId): (typeof SHELVES)[number] {
  const shelf = SHELVES.find((candidate) => candidate.id === id);
  if (!shelf) throw new Error(`Twelves has no ${id} shelf`);
  return shelf;
}
