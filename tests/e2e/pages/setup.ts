import { expect, type Locator, type Response } from "@playwright/test";
import { formatCount } from "../../../src/shared/display.ts";
import type { DiggaApp } from "../support/app.ts";
import { HeaderPage } from "./header.ts";
import { isRequest } from "./triage.ts";

/** The steps in the address; Node cannot import the rune module that declares them. */
export type SetupStep = "catalogue" | "discogs" | "sound" | "crate";

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
 * the listing that enables Fetch, and returns once the work it starts has answered.
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

  get startDiggingButton(): Locator {
    return this.button("Start digging");
  }

  /** The styles the sound step has picked, as stamps with their counts. */
  get pickedStyles(): Locator {
    return this.root.getByRole("list", { name: "Picked styles" });
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

  /** Step 1: Enter once the listing has enabled Fetch; returns on step 2, the download started. */
  async fetchCatalogue(): Promise<void> {
    await expect(this.button("Fetch the catalogue")).toBeEnabled();
    const started = this.#response("POST", "/api/jobs/dump-download");
    await this.app.page.keyboard.press("Enter");
    await this.#answered(started);
    await expect(this.heading("discogs")).toBeVisible();
  }

  /** Step 2: saves the token; returns once Discogs has accepted it and the account shows. */
  async connect(token: string): Promise<void> {
    await this.root.getByLabel("Token", { exact: true }).fill(token);
    const saved = this.#response("PUT", "/api/discogs/token");
    await this.button("Connect").click();
    await this.#answered(saved);
    await expect(this.root.getByRole("status").filter({ hasText: "Connected as" })).toBeVisible();
  }

  /** Step 2: Enter starts the chosen imports; step 3 shows once they have started. */
  async continueFromDiscogs(): Promise<void> {
    await expect(this.button("Continue")).toBeEnabled();
    await this.app.page.keyboard.press("Enter");
    await expect(this.heading("sound")).toBeVisible();
  }

  async skipDiscogs(): Promise<void> {
    await this.button("Skip").click();
    await expect(this.heading("sound")).toBeVisible();
  }

  /** Step 3: the imports' styles, picked once the imports have finished. */
  async keepSuggestedStyles(styles: string[]): Promise<void> {
    await expect(this.root.getByText("Your Discogs records are mostly")).toBeVisible();
    for (const style of styles)
      await expect(
        this.pickedStyles.getByRole("button", { name: `Remove ${style}` }),
      ).toBeVisible();
  }

  /** Step 3: the search's Enter picks its first match. */
  async pickStyle(style: string): Promise<void> {
    await this.root.getByRole("searchbox", { name: "Find a style" }).fill(style);
    await this.app.page.keyboard.press("Enter");
    await expect(this.pickedStyles.getByRole("button", { name: `Remove ${style}` })).toBeVisible();
  }

  /** Step 3: saves the picks and starts the load; returns on the crate, the load started. */
  async fillCrate(): Promise<void> {
    await expect(this.button("Fill the crate")).toBeEnabled();
    const settingsSaved = this.#response("PUT", "/api/settings");
    const loadStarted = this.#response("POST", "/api/jobs/dump-load");
    await this.button("Fill the crate").click();
    await this.#answered(settingsSaved);
    await this.#answered(loadStarted);
    await expect(this.heading("crate")).toBeVisible();
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

  async #answered(pending: Promise<Response>): Promise<void> {
    const response = await pending;
    expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
    await response.finished();
  }
}
