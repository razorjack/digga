import { expect, type Locator, type Response } from "@playwright/test";
import { type RecordStamp, STATUS_COPY } from "../../../src/client/keymap.ts";
import {
  JUDGE_KEYS,
  type JudgedStatus,
  rejudgedSentence,
  type ShelfId,
  SHELVES,
  type SortId,
  SORTS,
} from "../../../src/client/twelves/model.ts";
import type { VerdictStatus } from "../../../src/shared/types.ts";
import type { DiggaApp } from "../support/app.ts";
import { isRequest, TriagePage, waitForResponses } from "./triage.ts";

/** The keys that move the selection by one row, and the keys that turn a page. */
export type MoveKey = "j" | "k" | "ArrowDown" | "ArrowUp";
export type TurnKey = "ArrowRight" | "ArrowLeft";

/** The key that re-judges the selected record, from Twelves' own key table. */
export function judgeKey(status: VerdictStatus): string {
  const key = Object.keys(JUDGE_KEYS).find((candidate) => JUDGE_KEYS[candidate] === status);
  if (!key) throw new Error(`no key in Twelves judges ${status}`);
  return key;
}

/**
 * Twelves' locators and actions. Each action returns once the work it starts has finished, not at
 * its first visible sign (docs/e2e/AUTHORING.md#synchronisation); checks stay in the tests.
 */
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

  /** The record's row on whichever shelf shows it, by its triage key. */
  record(key: string): Locator {
    return this.root.locator(`tr[data-triage-key="${key}"]`);
  }

  /** Every record row of the shelf on screen, in its order. */
  get records(): Locator {
    return this.root.locator("tr[data-triage-key]");
  }

  /** A marked track's row on the Tracks shelf. */
  track(releaseId: number, position: string): Locator {
    return this.root.locator(`tr[data-release-id="${releaseId}"][data-position="${position}"]`);
  }

  /** The selected row, record or track. */
  get selected(): Locator {
    return this.root.locator('tr[aria-current="true"]');
  }

  /** The verdict's stamp in a row; exact, since the market cell's "1,210 want" contains "want". */
  stamp(row: Locator, status: RecordStamp): Locator {
    return row.getByText(STATUS_COPY[status], { exact: true });
  }

  shelfOption(id: ShelfId): Locator {
    const label = shelfOf(id).label;
    return this.root
      .getByRole("group", { name: "Shelf" })
      .getByRole("radio", { name: new RegExp(`^${label} [\\d,]+$`) });
  }

  sortOption(id: SortId): Locator {
    const label = SORTS.find((sort) => sort.id === id)!.label;
    return this.root
      .getByRole("group", { name: "sort" })
      .getByRole("radio", { name: label, exact: true });
  }

  get filter(): Locator {
    return this.root.getByRole("searchbox", { name: "Filter" });
  }

  get noteField(): Locator {
    return this.root.getByRole("textbox", { name: "Note", exact: true });
  }

  get trackNoteField(): Locator {
    return this.root.getByRole("textbox", { name: "Note on the track" });
  }

  /** What the shelf says after an action, such as "Note saved." */
  get messages(): Locator {
    return this.root.getByRole("status");
  }

  /** The pager under the shelf, shown when it has more than one page. */
  get pager(): Locator {
    return this.root.getByRole("navigation", { name: "Shelf pages" });
  }

  /** What the shelf says about the Discogs wantlist: the wants missing from it, or none. */
  get wantlistHandoff(): Locator {
    return this.root.getByText(
      /^([\d,]+ records? (is|are) not on your Discogs wantlist\.|Everything here is on your Discogs wantlist\.)/,
    );
  }

  /** What the shelf says about the Discogs Maybe list: the hint without one, or what is missing. */
  get maybeHandoff(): Locator {
    return this.root.getByText(
      /^(Pick your Discogs Maybe list in Settings|[\d,]+ maybes? (is|are) not on your Discogs Maybe list yet\.|Every maybe here is on your Discogs Maybe list\.)/,
    );
  }

  get addAllButton(): Locator {
    return this.root.getByRole("button", { name: /^add all [\d,]+$/ });
  }

  /** Opens Twelves; returns once its verdicts and track marks have loaded and show. */
  async open(): Promise<void> {
    const loaded = this.#response("GET", "/api/twelves");
    await this.app.open("#/twelves");
    await completed(await loaded);
    await expect(this.root.getByRole("heading", { name: "Twelves" })).toBeVisible();
    await expect(this.root.getByText("Loading…", { exact: true })).toBeHidden();
  }

  /** Reloads the page; returns once Twelves has loaded again. */
  async reload(): Promise<void> {
    const loaded = this.#response("GET", "/api/twelves");
    await this.app.page.reload();
    await completed(await loaded);
    await expect(this.root.getByText("Loading…", { exact: true })).toBeHidden();
  }

  /** The triage keys of the shelf's rows, in their order. Never waits. */
  async recordKeys(): Promise<(string | null)[]> {
    return this.records.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-triage-key")),
    );
  }

  /**
   * Whether the row's middle is on screen and the row itself is there, not the sticky footer or
   * anything else drawn over it. Never waits.
   */
  async isUncovered(row: Locator): Promise<boolean> {
    return row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && element.contains(hit);
    });
  }

  /** The shelf's key; returns once the shelf is the chosen one. */
  async showShelf(id: ShelfId): Promise<void> {
    const option = this.shelfOption(id);
    await expect(option).toBeVisible();
    await this.app.page.keyboard.press(String(SHELVES.indexOf(shelfOf(id)) + 1));
    await expect(option).toBeChecked();
  }

  /** The selected record's triage key, once a record is selected. */
  async selectedKey(): Promise<string> {
    await expect(this.selected).toHaveCount(1);
    const key = await this.selected.getAttribute("data-triage-key");
    if (key === null) throw new Error("the selected row is not a record");
    return key;
  }

  /** J, K, ↓ or ↑; returns the key of the record it selected. */
  async move(key: MoveKey): Promise<string> {
    return this.#changeSelection(key);
  }

  /** → or ←; returns the key of the record it selected, the first of the other page. */
  async turnPage(key: TurnKey): Promise<string> {
    return this.#changeSelection(key);
  }

  /**
   * Selects the record with J or K, whichever way it is from the selection; returns once it is
   * selected. Each key press moves the selection in its own handler, so the presses need no wait
   * between them.
   */
  async select(key: string): Promise<void> {
    await expect(this.record(key)).toHaveCount(1);
    const keys = await this.recordKeys();
    const steps = keys.indexOf(key) - keys.indexOf(await this.selectedKey());
    for (let step = 0; step < Math.abs(steps); step += 1)
      await this.app.page.keyboard.press(steps > 0 ? "j" : "k");
    await expect(this.record(key)).toHaveAttribute("aria-current", "true");
  }

  /** S; returns the order it chose, once its option is checked. */
  async cycleSort(): Promise<SortId> {
    const checked = await this.root
      .getByRole("group", { name: "sort" })
      .getByRole("radio", { checked: true })
      .getAttribute("value");
    const index = SORTS.findIndex((sort) => sort.id === checked);
    const next = SORTS[(index + 1) % SORTS.length]!.id;
    await this.app.page.keyboard.press("s");
    await expect(this.sortOption(next)).toBeChecked();
    return next;
  }

  /** `/`, then the text; returns once the filter holds it. */
  async filterBy(text: string): Promise<void> {
    await this.app.page.keyboard.press("/");
    await expect(this.filter).toBeFocused();
    await this.app.page.keyboard.type(text);
    await expect(this.filter).toHaveValue(new RegExp(`${escapeRegExp(text)}$`));
  }

  /** Enter in the filter: the shelf keys work again and the filter keeps its text. */
  async leaveFilter(): Promise<void> {
    await expect(this.filter).toBeFocused();
    await this.app.page.keyboard.press("Enter");
    await expect(this.filter).not.toBeFocused();
  }

  /** Esc in the filter: it is empty and the shelf keys work again. */
  async clearFilter(): Promise<void> {
    await expect(this.filter).toBeFocused();
    await this.app.page.keyboard.press("Escape");
    await expect(this.filter).toHaveValue("");
    await expect(this.filter).not.toBeFocused();
  }

  /** E: returns once the selected record's note field has focus. */
  async openNote(): Promise<void> {
    await expect(this.selected).toHaveCount(1);
    await this.app.page.keyboard.press("e");
    await expect(this.noteField).toBeFocused();
  }

  /**
   * E, the text and Enter on the selected record; an empty text removes the note. Returns once the
   * server has saved it as the shown release's note and the shelf says so.
   */
  async writeNote(text: string): Promise<void> {
    await this.openNote();
    await this.noteField.fill(text);
    const releaseId = await this.selected.getAttribute("data-release-id");
    const saved = this.#response("PUT", `/api/releases/${releaseId}/note`);
    await this.app.page.keyboard.press("Enter");
    await completed(await saved);
    await expect(this.messages).toHaveText(
      text === "" ? "Note removed. Z undoes it." : "Note saved. Z undoes it.",
    );
  }

  /**
   * The verdict's key on the selected record. Returns once the verdict is saved, the shelf has
   * loaded again and says what changed; a change that adds to or takes from the Discogs wantlist
   * says so only after the server has answered, which it does after the fake has.
   */
  async rejudge(status: JudgedStatus): Promise<void> {
    await expect(this.selected).toHaveCount(1);
    const { first: saved, next: reloaded } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "POST", "/api/verdicts"),
      (response) => isRequest(response, "GET", "/api/twelves"),
    );
    await this.app.page.keyboard.press(judgeKey(status));
    await completed(await saved);
    await completed(await reloaded);
    // The sentence starts with the record's name, which is not known here.
    const sentence = escapeRegExp(rejudgedSentence("", status));
    await expect(this.messages).toHaveText(new RegExp(`.${sentence}( .+)? Z undoes it\\.$`));
  }

  /**
   * The key of the selected want's or grail's own verdict, which adds it to the Discogs wantlist
   * again. Returns once the server has pushed it and the shelf has loaded again and says so.
   */
  async retryPush(status: "accepted" | "candidate"): Promise<Response> {
    const releaseId = await this.selected.getAttribute("data-release-id");
    const { first: pushed, next: reloaded } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "POST", `/api/discogs/wantlist/${releaseId}`),
      (response) => isRequest(response, "GET", "/api/twelves"),
    );
    await this.app.page.keyboard.press(judgeKey(status));
    const response = await pushed;
    await response.finished();
    await completed(await reloaded);
    await expect(this.messages).toHaveText(/: added to your Discogs wantlist\.$|^Not added/);
    return response;
  }

  /** The "add all" button: returns once every push has answered and the shelf says how many. */
  async addAllToWantlist(): Promise<void> {
    await this.addAllButton.click();
    await expect(this.messages).toHaveText(
      /^[\d,]+ added to your Discogs wantlist\.$|then Discogs refused|^Not added/,
      { timeout: 15_000 },
    );
  }

  /**
   * I: reads the Discogs Maybe list through a job; returns once the job has ended, the shelf has
   * loaded again and says what the list holds.
   */
  async checkMaybeList(): Promise<void> {
    const started = this.#response("POST", "/api/jobs/import/list");
    await this.app.page.keyboard.press("i");
    await completed(await started);
    await expect(this.messages).toHaveText(/^Your Discogs Maybe list has|^The list check failed/, {
      timeout: 15_000,
    });
  }

  /**
   * Z: returns once the previous verdict is saved again, its wantlist change undone, and the shelf
   * has loaded again and says so.
   */
  async undo(): Promise<void> {
    const { first: saved, next: reloaded } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "POST", "/api/verdicts"),
      (response) => isRequest(response, "GET", "/api/twelves"),
    );
    await this.app.page.keyboard.press("z");
    await completed(await saved);
    await completed(await reloaded);
    await expect(this.messages).toHaveText(/^Undone/);
  }

  /** Enter on the selected row: returns once Triage replays its record under the round's banner. */
  async replaySelected(releaseId: number): Promise<void> {
    await expect(this.selected).toHaveCount(1);
    await this.app.page.keyboard.press("Enter");
    const triage = new TriagePage(this.app);
    await expect(triage.record).toBeVisible();
    await expect(triage.banner).toContainText("Replaying Twelves");
    await expect(triage.record).toHaveAttribute("data-release-id", String(releaseId));
  }

  /** Enter on a snoozed record: returns once Triage hears it in a round of snoozed records. */
  async hearAgain(): Promise<void> {
    const key = await this.selectedKey();
    await this.app.page.keyboard.press("Enter");
    const triage = new TriagePage(this.app);
    await expect(triage.record).toBeVisible();
    await expect(triage.banner).toContainText("Hearing snoozed records again");
    await expect(triage.record).toHaveAttribute("data-triage-key", key);
  }

  /** E, the text and Enter on the selected track; returns once the server has saved the note. */
  async writeTrackNote(text: string): Promise<void> {
    await expect(this.selected).toHaveCount(1);
    await this.app.page.keyboard.press("e");
    await expect(this.trackNoteField).toBeFocused();
    await this.trackNoteField.fill(text);
    const saved = this.#response("POST", "/api/track-verdicts");
    await this.app.page.keyboard.press("Enter");
    await completed(await saved);
    await expect(this.messages).toHaveText(text === "" ? "Note removed." : "Note saved.");
  }

  /** Y: returns the address the app opened, a YouTube search for the selected record. */
  async searchYouTube(): Promise<string> {
    await expect(this.selected).toHaveCount(1);
    return this.app.expectExternalOpen(() => this.app.page.keyboard.press("y"));
  }

  /**
   * Pastes a YouTube link on the shelf; returns once the server has attached it to the selected
   * record's release, the shelf has loaded again and says so.
   */
  async attachVideo(url: string): Promise<void> {
    const releaseId = await this.selected.getAttribute("data-release-id");
    const { first: attached, next: reloaded } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "POST", `/api/releases/${releaseId}/videos`),
      (response) => isRequest(response, "GET", "/api/twelves"),
    );
    await this.app.paste(url);
    await completed(await attached);
    await completed(await reloaded);
    await expect(this.messages).toHaveText(/: link attached(, and back in the queue)?\.$/);
  }

  /**
   * A page turn takes the previous selection off the page, so the selected row's key is compared.
   * The selection moves in one update, so the selected row is always there to read.
   */
  async #changeSelection(key: MoveKey | TurnKey): Promise<string> {
    const before = await this.selectedKey();
    await this.app.page.keyboard.press(key);
    await expect(this.selected).not.toHaveAttribute("data-triage-key", before);
    return this.selectedKey();
  }

  /** Waits for the app's response to the request an action causes; arm it before the action. */
  #response(method: string, path: string): Promise<Response> {
    return this.app.page.waitForResponse((response) => isRequest(response, method, path));
  }
}

/** The request succeeded and its whole body has arrived, so the page can act on it. */
async function completed(response: Response): Promise<void> {
  expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
  await response.finished();
}

function shelfOf(id: ShelfId): (typeof SHELVES)[number] {
  const shelf = SHELVES.find((candidate) => candidate.id === id);
  if (!shelf) throw new Error(`Twelves has no ${id} shelf`);
  return shelf;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
