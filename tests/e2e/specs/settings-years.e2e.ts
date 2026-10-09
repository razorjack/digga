import type { Config } from "../../../src/shared/config.ts";
import { SettingsPage } from "../pages/settings.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small" } });

test(
  "SET-25 load years can be cleared and entered again",
  { tag: ["@SET-25", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    await settings.open("library");
    const from = app.page.getByRole("spinbutton", { name: "Load from year", exact: true });
    const to = app.page.getByRole("spinbutton", { name: "Load to year", exact: true });
    await from.fill("");
    await to.fill("");
    await settings.save();
    expect((await app.api.get<Config>("/api/settings")).universe.loadYears).toBeNull();

    await from.fill("1990");
    await to.fill("2010");
    await expect(from).toHaveValue("1990");
    await expect(to).toHaveValue("2010");
    await settings.save();
    expect((await app.api.get<Config>("/api/settings")).universe.loadYears).toEqual([1990, 2010]);
    await app.page.reload();
    await expect(from).toHaveValue("1990");
    await expect(to).toHaveValue("2010");
  },
);
