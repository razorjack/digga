import type { Locator } from "@playwright/test";
import { GLOBAL_KEYS, triageKeyGroups, TWELVES_KEY_GROUPS } from "../../../src/client/keymap.ts";
import { type Route, ROUTES } from "../../../src/client/routes.ts";
import type { QueueResponse, Stats } from "../../../src/shared/api.ts";
import type { ColorScheme } from "../../../src/shared/config.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { KeysDialog } from "../pages/dialogs.ts";
import { HeaderPage, page } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { TriagePage, verdictKey } from "../pages/triage.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

/** The page's background, the --bg token of styles.css, in each scheme. */
const BACKGROUND = { light: "rgb(238, 233, 220)", dark: "rgb(22, 22, 24)" };

test(
  "SHELL-01 a loaded library opens on Triage with its counts and first record",
  { tag: ["@SHELL-01", "@P0"] },
  async ({ app }) => {
    const stats = await app.api.get<Stats>("/api/stats");
    const queue = await app.api.get<QueueResponse>("/api/queue?limit=1");
    const first = queue.items[0]!;
    const triage = new TriagePage(app);

    await app.open();

    await expect(app.page).toHaveTitle("Triage – Digga");
    const header = app.page.getByRole("banner");
    await expect(header).toContainText(`${formatCount(stats.dug)} dug`);
    await expect(header).toContainText(`${formatCount(stats.remaining)} to go`);
    await expect(triage.record).toHaveAttribute("data-triage-key", first.triageKey);
    await expect(triage.record.getByRole("heading", { level: 1 })).toHaveText(first.artistDisplay);
  },
);

test(
  "SHELL-02 T, W and , switch pages; the current link, the hash and the title follow",
  { tag: ["@SHELL-02", "@P0"] },
  async ({ app }) => {
    const header = new HeaderPage(app);
    await app.open();
    await expect(shownPage(app, "triage")).toBeVisible();

    for (const route of ["twelves", "settings", "triage"] as const) {
      await app.page.keyboard.press(page(route).key.toLowerCase());

      await expect(shownPage(app, route)).toBeVisible();
      await expect(header.link(route)).toHaveAttribute("aria-current", "page");
      for (const other of ROUTES.filter((destination) => destination.route !== route))
        await expect(header.link(other.route)).not.toHaveAttribute("aria-current", "page");
      await expect(app.page).toHaveURL(`${app.origin}/#/${route}`);
      await expect(app.page).toHaveTitle(`${page(route).label} – Digga`);
    }
  },
);

test(
  "SHELL-03 page keys are ignored in a text field and with Cmd, Ctrl or Alt, and work from a checkbox",
  { tag: ["@SHELL-03", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    const twelvesKey = page("twelves").key.toLowerCase();
    await settings.open();

    await settings.username.click();
    await app.page.keyboard.type(`${page("triage").key}${page("twelves").key}`.toLowerCase());
    await expect(settings.username).toHaveValue("tw");
    expect(await currentHash(app)).toBe("#/settings");
    await settings.username.blur();

    for (const modifier of ["Meta", "Control", "Alt"]) {
      await app.page.keyboard.press(`${modifier}+${twelvesKey}`);
      // The key's handler runs before the press returns, and a page key sets the hash in it.
      expect(await currentHash(app), `${modifier}+${twelvesKey}`).toBe("#/settings");
    }

    // Decision 60: a clicked checkbox used to keep the page keys.
    const checkbox = settings.root.getByRole("checkbox", {
      name: "include releases without a year",
    });
    await checkbox.click();
    await expect(checkbox).toBeFocused();
    await new HeaderPage(app).goTo("triage");
  },
);

test(
  "SHELL-04 ? opens the Keys dialog with the page's groups; Esc, the close button and the backdrop close it; page keys stay quiet while it is open",
  { tag: ["@SHELL-04", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const keys = new KeysDialog(app);
    const header = new HeaderPage(app);
    await app.open();
    const key = await triage.currentKey();

    await keys.open();
    await expect(keys.groupTitles).toHaveText(
      groupTitles([...triageKeyGroups(10, false), GLOBAL_KEYS]),
    );
    await app.page.keyboard.press(page("twelves").key.toLowerCase());
    await app.page.keyboard.press(verdictKey("rejected"));
    expect(await currentHash(app)).toBe("#/triage");
    await expect(keys.root).toBeVisible();
    await keys.close("escape");
    await expect(app.page.locator("body")).toBeFocused();
    expect(await triage.currentKey()).toBe(key);
    expect(app.apiRequests()).not.toContain("POST /api/verdicts");

    for (const way of ["close button", "backdrop", "help key"] as const) {
      await keys.open();
      await keys.close(way);
      await expect(app.page.locator("body"), `focus after closing by the ${way}`).toBeFocused();
    }

    await header.goTo("twelves");
    await keys.open();
    await expect(keys.groupTitles).toHaveText(groupTitles([...TWELVES_KEY_GROUPS, GLOBAL_KEYS]));
    await keys.close("escape");
    await header.goTo("settings");
  },
);

test.describe("in the sandbox", () => {
  test.use({ diggaOptions: { sandbox: true } });

  test(
    "SHELL-05 the header's sandbox stamp links to the Sandbox setting, which is highlighted and focused",
    { tag: ["@SHELL-05", "@P1"] },
    async ({ app }) => {
      const header = new HeaderPage(app);
      const settings = new SettingsPage(app);
      await app.open();

      await expect(header.sandbox).toHaveAttribute("href", "#/settings/sandbox");
      await header.sandbox.click();

      await expect(app.page).toHaveURL(`${app.origin}/#/settings/sandbox`);
      await expect(settings.sandboxSwitch).toBeFocused();
      await expect(settings.sandboxSwitch).toHaveText("Turn off the sandbox");
      await expect(settings.sandbox).toBeInViewport();
      // The section is the page's current location, which also draws its highlight.
      await expect(settings.sandbox).toHaveAttribute("aria-current", "location");

      await header.goTo("settings");
      await expect(settings.sandbox).not.toHaveAttribute("aria-current");
    },
  );
});

test(
  "SHELL-07 with the queue and the stats unreachable, the header and Triage say so, and Enter loads the queue once they answer",
  { tag: ["@SHELL-07", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    app.expectProblems({
      aborted: [/^GET \/api\/(queue|stats)$/],
      consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
    });
    const queue = await app.abortRequests(
      { method: "GET", path: "/api/queue" },
      { times: Infinity },
    );
    const stats = await app.abortRequests(
      { method: "GET", path: "/api/stats" },
      { times: Infinity },
    );
    await app.open();

    // Triage asks for its queue only once the settings have loaded.
    await expect(triage.root.getByText("The queue did not load.", { exact: true })).toBeVisible();
    await expect(header.root).toContainText("Server unreachable");

    await queue.lift();
    await stats.lift();
    await triage.retryQueue();
    // The header reads the stats again when the page changes.
    await header.goTo("twelves");
    await expect(header.root).toContainText(/\d+ dug/);
    await expect(header.root).not.toContainText("Server unreachable");
  },
);

test.describe("with the settings unreachable as the app opens", () => {
  test.beforeEach(async ({ app }) => {
    app.expectProblems({
      aborted: [/^GET \/api\/settings$/],
      consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
    });
  });

  test(
    "SHELL-12 Triage says the settings did not load, starts no queue, and Enter reads them again",
    { tag: ["@SHELL-12", "@P2"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const settingsRead = await app.abortRequests(
        { method: "GET", path: "/api/settings" },
        { times: Infinity },
      );
      await app.open();

      await expect(
        triage.root.getByText("The settings did not load.", { exact: true }),
      ).toBeVisible();
      await expect(triage.root.getByRole("button", { name: "try again" })).toHaveAttribute(
        "aria-keyshortcuts",
        "Enter",
      );
      // The queue starts from the settings, so it was never asked for.
      expect(queueReadCount(app)).toBe(0);

      await settingsRead.lift();
      await triage.retrySettings();
    },
  );

  test(
    "SHELL-12 Settings says it did not load, and Try again shows the form",
    { tag: ["@SHELL-12", "@P2"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      const settingsRead = await app.abortRequests(
        { method: "GET", path: "/api/settings" },
        { times: Infinity },
      );
      await app.open("#/settings");

      await expect(settings.root.getByText(/^Settings did not load: /)).toBeVisible();
      await expect(settings.saveButton).toBeHidden();

      await settingsRead.lift();
      await settings.retryLoad();
      // Triage, mounted behind Settings, starts its queue once the settings are in.
      await header.goTo("triage");
      await expect(triage.record).toBeVisible();
    },
  );
});

test(
  "SHELL-09 System follows the emulated scheme, Light and Dark apply at once and survive a reload, and none restarts Triage's queue",
  { tag: ["@SHELL-09", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const settings = new SettingsPage(app);
    const header = new HeaderPage(app);
    await app.open();
    // A restarted queue would show the passed record first again.
    await triage.pass();
    const key = await triage.currentKey();
    await header.goTo("settings");
    await expect(settings.colorScheme("system")).toBeChecked();
    const queueReads = queueReadCount(app);

    await expectScheme(app, "system", BACKGROUND.dark);
    await app.page.emulateMedia({ colorScheme: "light" });
    await expectScheme(app, "system", BACKGROUND.light);

    await settings.chooseColorScheme("dark");
    await expectScheme(app, "dark", BACKGROUND.dark);
    await settings.chooseColorScheme("light");
    await app.page.emulateMedia({ colorScheme: "dark" });
    await expectScheme(app, "light", BACKGROUND.light);
    expect(queueReadCount(app)).toBe(queueReads);

    await triage.showAgain();
    expect(await triage.currentKey()).toBe(key);

    await app.page.reload();
    await expect(triage.record).toBeVisible();
    await expectScheme(app, "light", BACKGROUND.light);
  },
);

/** What shows that a page is open: Triage's record, or the other pages' heading. */
function shownPage(app: DiggaApp, route: Route): Locator {
  if (route === "triage") return new TriagePage(app).record;
  const main = app.page.getByRole("main");
  return main.getByRole("heading", { level: 1, name: page(route).label });
}

/** The page's hash, read in the page after the key presses before it have been handled. */
function currentHash(app: DiggaApp): Promise<string> {
  return app.page.evaluate(() => window.location.hash);
}

function groupTitles(groups: { title: string }[]): string[] {
  return groups.map((group) => group.title);
}

function queueReadCount(app: DiggaApp): number {
  return app.apiRequests().filter((request) => request === "GET /api/queue").length;
}

/** The root's attribute and computed scheme, and the page's background that follows them. */
async function expectScheme(app: DiggaApp, scheme: ColorScheme, background: string): Promise<void> {
  const root = app.page.locator(":root");
  await expect(root).toHaveAttribute("data-color-scheme", scheme);
  await expect(root).toHaveCSS("color-scheme", scheme === "system" ? "light dark" : scheme);
  await expect(app.page.locator("body")).toHaveCSS("background-color", background);
}
