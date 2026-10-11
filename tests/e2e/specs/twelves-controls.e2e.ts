import { TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small" } });

test(
  "TWL-29 arrow keys operate the focused sort controls",
  { tag: ["@TWL-29", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    await twelves.open();
    const newest = twelves.sortOption("newest");
    await newest.focus();
    await expect(newest).toBeFocused();
    await app.page.keyboard.press("ArrowRight");
    await expect(twelves.sortOption("label")).toBeChecked();
    await app.page.keyboard.press("ArrowLeft");
    await expect(newest).toBeChecked();
  },
);
