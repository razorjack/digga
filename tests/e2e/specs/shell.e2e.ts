import type { Locator } from "@playwright/test";
import { type Route, ROUTES } from "../../../src/client/routes.ts";
import type { QueueResponse, Stats } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { HeaderPage, page } from "../pages/header.ts";
import { TriagePage } from "../pages/triage.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

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

/** What shows that a page is open: Triage's record, or the other pages' heading. */
function shownPage(app: DiggaApp, route: Route): Locator {
  if (route === "triage") return new TriagePage(app).record;
  const main = app.page.getByRole("main");
  return main.getByRole("heading", { level: 1, name: page(route).label });
}
