import type { Config } from "../../../src/shared/config.ts";
import { SettingsPage } from "../pages/settings.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small", dumpFiles: ["september"] } });

test(
  "SET-28 jobs require saving or discarding draft settings",
  { tag: ["@SET-28", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    await settings.open("library");
    const load = settings.dumpSection.getByRole("button", { name: "Load", exact: true });
    const update = settings.dumpSection.getByRole("button", {
      name: "Update the catalogue",
    });
    const download = settings.dumpSection.getByRole("button", { name: "Download only" });
    await expect(load).toBeEnabled();
    await settings.change(
      settings.root.getByRole("textbox", { name: "Styles", exact: true }),
      "Jungle",
    );
    await expect(load).toBeDisabled();
    await expect(update).toBeDisabled();
    await expect(download).toBeDisabled();
    await expect(settings.dumpSection.getByRole("status")).toHaveText(
      "Save or discard your changes before starting a download, load or import.",
    );
    await settings.save();
    const saved = await app.api.get<Config>("/api/settings");
    expect(saved.universe.styles).toEqual(["Jungle"]);
    await expect(load).toBeEnabled();
    await expect(update).toBeEnabled();
    await expect(download).toBeEnabled();

    await settings.showTab("discogs");
    const collection = settings.imports.getByRole("button", {
      name: "Import collection",
      exact: true,
    });
    const wantlist = settings.imports.getByRole("button", { name: "Import wantlist", exact: true });
    await expect(collection).toBeEnabled();
    await settings.username.fill("another-account");
    await expect(collection).toBeDisabled();
    await expect(wantlist).toBeDisabled();
    await expect(settings.imports.getByRole("status")).toHaveText(
      "Save or discard your changes before starting a download, load or import.",
    );
    await settings.revertButton.click();
    await expect(collection).toBeEnabled();
    await expect(wantlist).toBeEnabled();
    await expect(settings.username).toHaveValue(saved.discogs.username);
  },
);
