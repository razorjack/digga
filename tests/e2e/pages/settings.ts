import { expect, type Locator, type Response } from "@playwright/test";
import type { ColorScheme, QueueStrategy } from "../../../src/shared/config.ts";
import type { Job, JobStatus } from "../../../src/shared/types.ts";
import type { DiggaApp } from "../support/app.ts";
import { HeaderPage } from "./header.ts";
import { isRequest, waitForResponses } from "./triage.ts";

/** What the save bar says once a save and the queue's reload have answered. */
export const SAVED_COPY = "Saved. The queue has reloaded.";

/** What the page says once the sandbox has switched, by the mode it switched to. */
const SANDBOX_SWITCHED = {
  on: "Back in the sandbox: verdicts stay in this tab again.",
  off: "Sandbox off: verdicts are saved from now on.",
};

/** The Appearance radios' labels; the component holds them, not a module the tests can import. */
const COLOR_SCHEME_LABEL: Record<ColorScheme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** The Order radios' labels, which the component holds. */
const STRATEGY_LABEL: Record<QueueStrategy, string> = {
  label_sweep: "Label sweep",
  country: "By country",
  year: "By year",
  random: "Shuffled",
};

/** A job's row can wait for Discogs' 1.1 s spacing several times, and a dump job for its worker. */
const JOB_TIMEOUT_MS = 15_000;

/**
 * The Settings page's locators and actions. Each action returns once the work it starts has
 * finished (docs/e2e/AUTHORING.md#synchronisation); checks stay in the tests.
 */
export class SettingsPage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("main");
  }

  get sandbox(): Locator {
    return this.root.getByRole("region", { name: "Sandbox" });
  }

  /** The Sandbox section's button, which turns the sandbox off or back on. */
  get sandboxSwitch(): Locator {
    return this.sandbox.getByRole("button", {
      name: /^(Turn off the sandbox|Back to the sandbox|Switching…)$/,
    });
  }

  get appearance(): Locator {
    return this.root.getByRole("group", { name: "Appearance" });
  }

  colorScheme(scheme: ColorScheme): Locator {
    return this.appearance.getByRole("radio", { name: COLOR_SCHEME_LABEL[scheme] });
  }

  get library(): Locator {
    return this.root.getByRole("region", { name: "Library" });
  }

  get exports(): Locator {
    return this.root.getByRole("region", { name: "Backups and exports" });
  }

  get discogs(): Locator {
    return this.root.getByRole("region", { name: "Discogs" });
  }

  get jobs(): Locator {
    return this.root.getByRole("region", { name: "Jobs" });
  }

  get skipHistory(): Locator {
    return this.root.getByRole("checkbox", { name: "skip records opened before", exact: true });
  }

  get skipHeard(): Locator {
    return this.root.getByRole("checkbox", { name: "skip tunes heard before", exact: true });
  }

  get fromYear(): Locator {
    return this.root.getByRole("spinbutton", { name: "From year", exact: true });
  }

  /** A style of the universe's, which the queue digs while it is checked; shown for two or more. */
  styleFilter(style: string): Locator {
    return this.root
      .getByRole("group", { name: "Styles", exact: true })
      .getByRole("checkbox", { name: style, exact: true });
  }

  strategy(strategy: QueueStrategy): Locator {
    return this.root
      .getByRole("group", { name: "Order" })
      .getByRole("radio", { name: STRATEGY_LABEL[strategy], exact: true });
  }

  get currency(): Locator {
    return this.discogs.getByRole("combobox", { name: "Currency" });
  }

  get hiddenLabels(): Locator {
    return this.root.getByRole("textbox", { name: "Hidden labels" });
  }

  get batch(): Locator {
    return this.root.getByRole("spinbutton", { name: "Batch" });
  }

  get startAt(): Locator {
    return this.root.getByRole("slider", { name: "Start at" });
  }

  get seekStep(): Locator {
    return this.root.getByRole("spinbutton", { name: "Seek step" });
  }

  /** "These filters match N records, M still to dig." once the preview has answered. */
  get preview(): Locator {
    return this.root.getByText(/^These filters match/);
  }

  get saveButton(): Locator {
    return this.root.getByRole("button", { name: /^Save settings/ });
  }

  get revertButton(): Locator {
    return this.root.getByRole("button", { name: "Revert" });
  }

  get username(): Locator {
    return this.discogs.getByRole("textbox", { name: "Username" });
  }

  get token(): Locator {
    // A password field has no textbox role.
    return this.discogs.getByLabel("Token", { exact: true });
  }

  get saveTokenButton(): Locator {
    return this.discogs.getByRole("button", { name: /^(Save token|Checking…)$/ });
  }

  get maybeList(): Locator {
    return this.discogs.getByRole("combobox", { name: "Maybe list" });
  }

  /** Reads "Read my lists" until lists have loaded, then "Reload lists". */
  get listsButton(): Locator {
    return this.discogs.getByRole("button", {
      name: /^(Read my lists|Reload lists|Reading lists…)$/,
    });
  }

  get dumps(): Locator {
    return this.jobs.getByRole("list", { name: "Dumps in the folder" });
  }

  /** The dump's row in the folder's list, with its size and use. */
  dump(name: string): Locator {
    return this.dumps.getByRole("listitem").filter({ hasText: name });
  }

  /** The file Load reads, typed or picked from the datalist of the folder's dumps. */
  get dumpFile(): Locator {
    return this.jobs.getByRole("combobox", { name: "Dump file" });
  }

  /** The names the dump file field's datalist offers, in order. Never waits. */
  async dumpFileOptions(): Promise<string[]> {
    return this.dumpFile.evaluate((input) =>
      [...((input as HTMLInputElement).list?.options ?? [])].map((option) => option.value),
    );
  }

  /** The visible text of a delete button names its dump only for screen readers. */
  deleteButton(name: string): Locator {
    return this.dumps.getByRole("button", { name: `Delete ${name}`, exact: true });
  }

  job(id: string): Locator {
    return this.jobs.locator(`[data-job-id="${id}"]`);
  }

  /** The row's status cell, while it reads the status. */
  jobStatus(id: string, status: JobStatus): Locator {
    return this.job(id).getByRole("cell", { name: status, exact: true });
  }

  /** The page with its form, which shows once the settings have loaded. */
  async open(): Promise<void> {
    await this.app.open("#/settings");
    await expect(this.saveButton).toBeVisible();
  }

  /** "Try again" after the settings failed to load: returns once they have loaded and the form shows. */
  async retryLoad(): Promise<void> {
    await expect(this.root.getByText(/^Settings did not load: /)).toBeVisible();
    const loaded = this.app.page.waitForResponse((response) =>
      isRequest(response, "GET", "/api/settings"),
    );
    await this.root.getByRole("button", { name: "Try again" }).click();
    expect((await loaded).ok()).toBe(true);
    await expect(this.saveButton).toBeVisible();
  }

  /** Clicks Save; returns once the save and the queue's reload have answered and the bar says so. */
  async save(): Promise<void> {
    await this.#saveBy(() => this.saveButton.click());
  }

  /** The same with Cmd+S or Ctrl+S, wherever the focus is. */
  async saveWithShortcut(): Promise<void> {
    await this.#saveBy(() => this.app.page.keyboard.press("ControlOrMeta+s"));
  }

  /**
   * The Sandbox section's button. The page saves the mode at once, switches the api, and the
   * hidden Triage page reads its queue in the new mode; returns once both have answered, the page
   * says so and the header's sandbox stamp follows.
   */
  async switchSandbox(mode: "on" | "off"): Promise<void> {
    const header = new HeaderPage(this.app);
    const { first: saved, next: queue } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "PUT", "/api/settings"),
      (response) => isRequest(response, "GET", "/api/queue"),
    );
    const label = mode === "on" ? "Back to the sandbox" : "Turn off the sandbox";
    await expect(this.sandboxSwitch).toHaveText(label);
    await this.sandboxSwitch.click();
    await this.#completed(await saved);
    await this.#completed(await queue);
    await expect(this.root.getByText(SANDBOX_SWITCHED[mode], { exact: true })).toBeVisible();
    if (mode === "on") await expect(header.sandbox).toBeVisible();
    else await expect(header.sandbox).toBeHidden();
  }

  /**
   * An Appearance radio, which the page saves at once without restarting the queue; returns once
   * the save has answered and the root element carries the scheme.
   */
  async chooseColorScheme(scheme: ColorScheme): Promise<void> {
    const saved = this.#response("PUT", "/api/settings");
    await this.colorScheme(scheme).check();
    await this.#completed(await saved);
    await expect(this.app.page.locator(":root")).toHaveAttribute("data-color-scheme", scheme);
  }

  /** Types into a field that takes its value on change, which fires when the field loses focus. */
  async change(field: Locator, value: string): Promise<void> {
    await field.fill(value);
    await field.blur();
  }

  /** Saves the token, or removes it with null; returns the answer once the status line reads it. */
  async saveToken(token: string | null): Promise<Response> {
    const saved = this.#response("PUT", "/api/discogs/token");
    if (token === null) {
      await this.discogs.getByRole("button", { name: "Remove" }).click();
    } else {
      await this.token.fill(token);
      await this.saveTokenButton.click();
    }
    const response = await saved;
    await response.finished();
    await expect(this.saveTokenButton).toHaveText("Save token");
    return response;
  }

  /** "Read my lists" or "Reload lists"; returns once the server has answered and the page shows it. */
  async readLists(): Promise<void> {
    const read = this.#response("GET", "/api/discogs/lists");
    await this.listsButton.click();
    await (await read).finished();
    await expect(this.listsButton).not.toHaveText("Reading lists…");
  }

  /** Clicks a job's button; returns the job's id once its row shows. */
  async startJob(button: Locator): Promise<string> {
    const started = this.app.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith("/api/jobs/"),
    );
    await button.click();
    const response = await started;
    expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
    const job = (await response.json()) as Job;
    await expect(this.job(job.id)).toBeVisible();
    return job.id;
  }

  /** Returns once the job's row reads the status; the page polls the jobs every second. */
  async waitForJob(id: string, status: JobStatus): Promise<void> {
    await expect(this.jobStatus(id, status)).toBeVisible({ timeout: JOB_TIMEOUT_MS });
  }

  /** The row's Cancel; returns once the server has taken it and the page has read the jobs again. */
  async cancelJob(id: string): Promise<void> {
    const { first: cancel, next: jobs } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "POST", `/api/jobs/${id}/cancel`),
      (response) => isRequest(response, "GET", "/api/jobs"),
    );
    await this.job(id).getByRole("button", { name: "Cancel" }).click();
    await this.#completed(await cancel);
    await this.#completed(await jobs);
  }

  /**
   * Delete on a dump, answering the confirmation as told; returns its message. An accepted delete
   * returns once the server has answered with the folder's new listing and the page shows it.
   */
  async deleteDump(name: string, answer: "accept" | "dismiss"): Promise<string> {
    const asked = Promise.withResolvers<string>();
    this.app.page.once("dialog", async (dialog) => {
      asked.resolve(`${dialog.type()}: ${dialog.message()}`);
      if (answer === "accept") await dialog.accept();
      else await dialog.dismiss();
    });
    const deleted =
      answer === "accept" ? this.#response("DELETE", `/api/dumps/${name}`) : Promise.resolve(null);
    await this.deleteButton(name).click();
    const message = await asked.promise;
    const response = await deleted;
    if (response) {
      await this.#completed(response);
      await expect(this.dump(name)).toHaveCount(0);
    }
    return message;
  }

  /** The save is a PUT; the hidden Triage page then reloads its queue, after which the bar says so. */
  async #saveBy(action: () => Promise<void>): Promise<void> {
    const { first: settings, next: queue } = waitForResponses(
      this.app.page,
      (response) => isRequest(response, "PUT", "/api/settings"),
      (response) => isRequest(response, "GET", "/api/queue"),
    );
    await action();
    await this.#completed(await settings);
    await this.#completed(await queue);
    await expect(this.root.getByText(SAVED_COPY, { exact: true })).toBeVisible();
  }

  #response(method: string, path: string): Promise<Response> {
    return this.app.page.waitForResponse((response) => isRequest(response, method, path));
  }

  async #completed(response: Response): Promise<void> {
    expect(response.ok(), `${response.request().method()} ${response.url()}`).toBe(true);
    await response.finished();
  }
}
