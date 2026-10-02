import { expect, type Locator, type Response } from "@playwright/test";
import { SETUP_STEPS, type SetupStep } from "../../../src/client/setup/steps.ts";
import type { ImportKind } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import type { DiggaApp } from "../support/app.ts";
import { HeaderPage } from "./header.ts";
import { isRequest } from "./triage.ts";

export type { SetupStep };

/** What step 3 asks for, as the tests pick it. */
export interface Picks {
  styles: string[];
  span: [number, number];
  vinylOnly: boolean;
}

/** Each step's heading, which shows once the work that leads to the step has answered. */
const STEP_HEADINGS: Record<SetupStep, string> = {
  catalogue: "Dig every record in your styles, by ear.",
  discogs: "Bring your Discogs",
  sound: "Pick your sound",
  crate: "Fill the crate",
};

/**
 * The crate reads the records to dig every 3 s and the job every second, and the load commits
 * what has arrived within a second, so a count can take about 5 s to show.
 */
const COUNT_TIMEOUT_MS = 15_000;

/**
 * The first run's four steps (docs/FIRST_RUN.md). Each action waits for its precondition, such as
 * the listing that enables Fetch, and returns once the work it starts has answered; one that
 * changes the step returns once the address and the step list show the new step.
 */
export class SetupPage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("main");
  }

  heading(step: SetupStep): Locator {
    return this.root.getByRole("heading", { level: 1, name: STEP_HEADINGS[step] });
  }

  /** The step's button, by its visible name. */
  button(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** The step list's item for the step the setup is on. */
  get currentStep(): Locator {
    return this.root.getByRole("list", { name: "Setup" }).locator('[aria-current="step"]');
  }

  /** The step's alerts: the space alert, and the error of the step's last action. */
  alert(text: string | RegExp): Locator {
    return this.root.getByRole("alert").filter({ hasText: text });
  }

  get startDiggingButton(): Locator {
    return this.button("Start digging");
  }

  /** The strip at the foot of steps 2 and 3 while the catalogue downloads. */
  get downloadStrip(): Locator {
    return this.root.getByRole("complementary", { name: "Download", exact: true });
  }

  /** Where and why the download stopped, on steps 2 and 3 and in the crate. */
  get downloadStopped(): Locator {
    return this.alert(/^The download stopped/);
  }

  get tokenField(): Locator {
    return this.root.getByLabel("Token", { exact: true });
  }

  /** "Connected as dj: …", in a status region that stays in the step. */
  get account(): Locator {
    return this.root.getByRole("status").filter({ hasText: "Connected as" });
  }

  get currency(): Locator {
    return this.root.getByRole("combobox", { name: "Prices in" });
  }

  get seedsCheckbox(): Locator {
    return this.root.getByRole("checkbox", { name: /^Read my collection and wantlist/ });
  }

  get styleSearch(): Locator {
    return this.root.getByRole("searchbox", { name: "Find a style" });
  }

  /** The styles the sound step has picked, as stamps with their counts. */
  get pickedStyles(): Locator {
    return this.root.getByRole("list", { name: "Picked styles" });
  }

  /** The stamp's remove button, which shows while the style is picked. */
  removeButton(style: string): Locator {
    return this.pickedStyles.getByRole("button", { name: `Remove ${style}` });
  }

  get suggestion(): Locator {
    return this.root.getByText("Your Discogs records are mostly");
  }

  /** A genre's styles, which show while its disclosure is open. */
  genreStyles(genre: string): Locator {
    return this.root.getByRole("group", { name: `${genre} styles` });
  }

  get years(): Locator {
    return this.root.getByRole("group", { name: "Years" });
  }

  /** The span to dig, or with `load`, the years the load keeps. */
  yearField(end: "from" | "to", options: { load?: boolean } = {}): Locator {
    const name = options.load ? `load ${end}` : end;
    return this.years.getByRole("spinbutton", { name, exact: true });
  }

  /** The disclosure's summary, which names the years the load keeps. */
  get loadYearsSummary(): Locator {
    return this.years.getByText(/^Digga loads \d{4}–\d{4}/);
  }

  get vinylOnly(): Locator {
    return this.years.getByRole("checkbox", { name: "Vinyl only" });
  }

  /** The sound step's estimate of what the picks bring. */
  get estimate(): Locator {
    return this.root.getByRole("status").filter({ hasText: /^About / });
  }

  /** The crate's progress bar for the download or the read. */
  progress(label: "Download" | "Read"): Locator {
    return this.root.getByRole("progressbar", { name: label, exact: true });
  }

  releasesKept(count: number): Locator {
    return this.root.getByText(`${formatCount(count)} releases kept`, { exact: true });
  }

  recordsToDig(count: number): Locator {
    return this.root.getByText(`${formatCount(count)} records to dig`, { exact: true });
  }

  /** The heading, the step list and the address all show the step; the address follows the render. */
  async expectStep(step: SetupStep): Promise<void> {
    await expect(this.heading(step)).toBeVisible();
    await expect(this.currentStep).toContainText(stepTitle(step));
    await expect(this.app.page).toHaveURL(new RegExp(`#/setup/${step}$`));
  }

  /** Reloads the page; returns once the setup has opened on the step again. */
  async reload(step: SetupStep): Promise<void> {
    await this.app.page.reload();
    await this.expectStep(step);
  }

  /** Step 1: Enter once the listing has enabled Fetch; returns on step 2, the download started. */
  async fetchCatalogue(): Promise<void> {
    await expect(this.button("Fetch the catalogue")).toBeEnabled();
    const started = this.#response("POST", "/api/jobs/dump-download");
    await this.app.page.keyboard.press("Enter");
    await answered(started);
    await this.expectStep("discogs");
  }

  /** Step 1 with the catalogue downloading or downloaded already: Enter moves on. */
  async continueFromCatalogue(): Promise<void> {
    await expect(this.button("Continue")).toBeEnabled();
    await this.app.page.keyboard.press("Enter");
    await this.expectStep("discogs");
  }

  /** Step 1's "Try again" or "Check again": returns once the setup has read the catalogue again. */
  async readCatalogueAgain(button: "Try again" | "Check again"): Promise<void> {
    const read = this.#response("GET", "/api/setup");
    await this.button(button).click();
    await answered(read);
  }

  /** Step 2: saves the token; returns once Discogs has accepted it and the account's sizes show. */
  async connect(token: string): Promise<void> {
    await this.tokenField.fill(token);
    const saved = this.#response("PUT", "/api/discogs/token");
    const profile = this.#response("GET", "/api/discogs/profile");
    await this.button("Connect").click();
    await answered(saved);
    await answered(profile);
    await expect(this.account).toBeVisible();
    await expect(this.button("Continue")).toBeEnabled();
  }

  /**
   * Step 2's "No token? Use your username": returns once the username is saved and the public
   * profile's sizes show. Without a token the server asks Discogs nothing for the account.
   */
  async useUsername(username: string): Promise<void> {
    await this.root.getByText("No token? Use your username", { exact: true }).click();
    await this.root.getByLabel("Discogs username", { exact: true }).fill(username);
    const saved = this.#response("PUT", "/api/settings");
    const profile = this.#response("GET", "/api/discogs/profile");
    await this.button("Use it").click();
    await answered(saved);
    await answered(profile);
    await expect(this.account).toBeVisible();
    await expect(this.button("Continue")).toBeEnabled();
  }

  /** Step 2 with a token Discogs refuses: returns once the step has the answer and Connect again. */
  async connectRefused(token: string): Promise<void> {
    await this.tokenField.fill(token);
    const refused = this.#response("PUT", "/api/discogs/token");
    await this.button("Connect").click();
    const response = await refused;
    expect(response.status(), "Discogs refused the token").toBe(400);
    await response.finished();
    await expect(this.button("Connect")).toBeEnabled();
  }

  /**
   * Step 2: Enter starts the chosen imports and moves on; returns on step 3 once every import
   * named has started as a job.
   */
  async continueFromDiscogs(imports: ImportKind[] = []): Promise<void> {
    await expect(this.button("Continue")).toBeEnabled();
    const started = imports.map((kind) => this.#response("POST", `/api/jobs/import/${kind}`));
    await this.app.page.keyboard.press("Enter");
    for (const job of started) await answered(job);
    await this.expectStep("sound");
  }

  async skipDiscogs(): Promise<void> {
    await this.button("Skip").click();
    await this.expectStep("sound");
  }

  /** Back to the step before; the download, if any, goes on. */
  async back(to: SetupStep): Promise<void> {
    await this.button("Back").click();
    await this.expectStep(to);
  }

  /** Step 3: the imports' styles, picked once the imports have finished. */
  async keepSuggestedStyles(styles: string[]): Promise<void> {
    await expect(this.suggestion).toBeVisible();
    for (const style of styles) await expect(this.removeButton(style)).toBeVisible();
  }

  /** Step 3: the search's Enter picks its first match, `style`, and clears the search. */
  async pickStyle(style: string, query: string = style): Promise<void> {
    await this.styleSearch.fill(query);
    await this.app.page.keyboard.press("Enter");
    await expect(this.removeButton(style)).toBeVisible();
    await expect(this.styleSearch).toHaveValue("");
  }

  /** Step 3: a style "Often tagged with" the picks joins them. */
  async addOftenTagged(style: string): Promise<void> {
    await this.root.getByRole("button", { name: `+ ${style}`, exact: true }).click();
    await expect(this.removeButton(style)).toBeVisible();
  }

  async removeStyle(style: string): Promise<void> {
    await this.removeButton(style).click();
    await expect(this.removeButton(style)).toBeHidden();
  }

  /** Step 3: opens a genre's disclosure; returns once its styles show. */
  async openGenre(genre: string): Promise<void> {
    await this.root.getByText(new RegExp(`^${genre} \\d+ styles$`)).click();
    await expect(this.genreStyles(genre)).toBeVisible();
  }

  /** Step 3: types a year and leaves the field, which commits it, as a person does with Tab. */
  async setYear(end: "from" | "to", year: number, options: { load?: boolean } = {}): Promise<void> {
    const field = this.yearField(end, options);
    await field.fill(String(year));
    await field.press("Tab");
    await expect(field).toHaveValue(String(year));
  }

  /** Step 3: opens the disclosure with the years the load keeps. */
  async openLoadYears(): Promise<void> {
    await this.loadYearsSummary.click();
    await expect(this.yearField("from", { load: true })).toBeVisible();
  }

  async setVinylOnly(on: boolean): Promise<void> {
    await this.vinylOnly.setChecked(on);
  }

  /**
   * Step 3: "Fill the crate" with no style picked; returns once the search field reports it. The
   * step sends nothing, so the page's requests are the test's to check.
   */
  async fillCrateWithoutStyles(): Promise<void> {
    await this.button("Fill the crate").click();
    await expect(this.styleSearch).toHaveAttribute("aria-invalid", "true");
  }

  /** Step 3: saves the picks and starts the load; returns on the crate, the load started. */
  async fillCrate(): Promise<void> {
    await expect(this.button("Fill the crate")).toBeEnabled();
    const settingsSaved = this.#response("PUT", "/api/settings");
    const loadStarted = this.#response("POST", "/api/jobs/dump-load");
    await this.button("Fill the crate").click();
    await answered(settingsSaved);
    await answered(loadStarted);
    await this.expectStep("crate");
  }

  /**
   * Step 3 while the imports run: saves the picks and moves to the crate, where the load waits
   * for the imports; returns once the crate says so.
   */
  async fillCrateBehindImports(): Promise<void> {
    await expect(this.button("Fill the crate")).toBeEnabled();
    const settingsSaved = this.#response("PUT", "/api/settings");
    await this.button("Fill the crate").click();
    await answered(settingsSaved);
    await this.expectStep("crate");
    await expect(this.root.getByText(/^Reading your collection and wantlist first/)).toBeVisible();
  }

  /**
   * The crate's "Change your picks": returns on step 3 once the load has stopped and the releases
   * it added without a verdict are gone.
   */
  async changePicks(): Promise<void> {
    const forgotten = this.#response("DELETE", "/api/setup/load");
    await this.button("Change your picks").click();
    await answered(forgotten);
    await this.expectStep("sound");
  }

  /** Step 3: picks the styles one by one, then the years, then Vinyl only. */
  async makePicks(picks: Picks): Promise<void> {
    for (const style of picks.styles) await this.pickStyle(style);
    await this.setYear("from", picks.span[0]);
    await this.setYear("to", picks.span[1]);
    await this.setVinylOnly(picks.vinylOnly);
  }

  /** Step 3 shows these picks: the styles, the years to dig and Vinyl only, and no suggestion. */
  async expectPicks(picks: Picks): Promise<void> {
    await expect(this.pickedStyles.getByRole("button")).toHaveCount(picks.styles.length);
    for (const style of picks.styles) await expect(this.removeButton(style)).toBeVisible();
    await expect(this.yearField("from")).toHaveValue(String(picks.span[0]));
    await expect(this.yearField("to")).toHaveValue(String(picks.span[1]));
    if (picks.vinylOnly) await expect(this.vinylOnly).toBeChecked();
    else await expect(this.vinylOnly).not.toBeChecked();
    await expect(this.suggestion).toBeHidden();
  }

  /** "Start again" on steps 2 and 3: returns once the new download runs under the strip. */
  async startDownloadAgain(): Promise<void> {
    await expect(this.downloadStopped).toBeVisible();
    const started = this.#response("POST", "/api/jobs/dump-download");
    await this.button("Start again").click();
    await answered(started);
    await expect(this.downloadStrip).toBeVisible();
    await expect(this.downloadStopped).toBeHidden();
  }

  /** "Start again" in the crate: returns once the download and the load reading it have started. */
  async startLoadAgain(): Promise<void> {
    await expect(this.downloadStopped).toBeVisible();
    const downloading = this.#response("POST", "/api/jobs/dump-download");
    const loading = this.#response("POST", "/api/jobs/dump-load");
    await this.button("Start again").click();
    await answered(downloading);
    await answered(loading);
    await expect(this.downloadStopped).toBeHidden();
  }

  /** The crate once it counts this many records to dig, which the setup reads every few seconds. */
  async waitForRecordsToDig(count: number): Promise<void> {
    await expect(this.recordsToDig(count)).toBeVisible({ timeout: COUNT_TIMEOUT_MS });
  }

  /** Clicks "Start digging" once it is enabled; returns once Triage is the page shown. */
  async startDigging(): Promise<void> {
    await expect(this.startDiggingButton).toBeEnabled();
    await this.startDiggingButton.click();
    await expect(new HeaderPage(this.app).link("triage")).toHaveAttribute("aria-current", "page");
  }

  #response(method: string, path: string): Promise<Response> {
    return this.app.page.waitForResponse((response) => isRequest(response, method, path));
  }
}

/** The step's name in the step list and the title. */
export function stepTitle(step: SetupStep): string {
  const entry = SETUP_STEPS.find((candidate) => candidate.step === step);
  if (!entry) throw new Error(`the setup has no step ${step}`);
  return entry.title;
}

/** The answer was a success and the page has its body. */
async function answered(pending: Promise<Response>): Promise<void> {
  const response = await pending;
  expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
  await response.finished();
}
