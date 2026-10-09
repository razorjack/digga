import type { Config } from "../../../src/shared/config.ts";
import { SettingsPage } from "../pages/settings.ts";
import { test, expect } from "../support/test.ts";

test.use({
  diggaOptions: {
    template: "small",
    config: { universe: { styles: ["Drum n Bass", "Neurofunk"] } },
  },
});

test(
  "SET-26 unchecking every style matches no records",
  { tag: ["@SET-26", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    await settings.open();
    await settings.styleFilter("Drum n Bass").uncheck();
    await settings.styleFilter("Neurofunk").uncheck();
    await settings.save();
    await expect(settings.preview).toHaveText("These filters match 0 records, 0 still to dig.");
    expect((await app.api.get<Config>("/api/settings")).filters.styles).toEqual([]);

    await settings.styleFilter("Drum n Bass").check();
    await settings.save();
    await expect(settings.preview).toHaveText(
      /^These filters match [1-9][\d,]* records, [\d,]+ still to dig\.$/,
    );
    expect((await app.api.get<Config>("/api/settings")).filters.styles).toEqual(["Drum n Bass"]);
  },
);
