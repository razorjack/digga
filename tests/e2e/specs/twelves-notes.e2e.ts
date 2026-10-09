import { FIRST_RECORD, triageKeyOf } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small" } });

test(
  "TWL-26 replay refreshes notes edited in Twelves",
  { tag: ["@TWL-26", "@P1"] },
  async ({ app }) => {
    await app.given.verdict({
      key: triageKeyOf(FIRST_RECORD),
      releaseId: FIRST_RECORD.id,
      status: "snoozed",
    });
    const twelves = new TwelvesPage(app);
    const triage = new TriagePage(app);
    await twelves.open();
    await twelves.hearAgain();
    await app.page.keyboard.press("e");
    await triage.noteField.fill("written in Triage");
    await triage.noteField.press("Enter");
    await expect(app.page.getByRole("status", { name: "Note save status" })).toHaveText(
      "Note saved.",
    );
    await triage.leaveRound();
    await new HeaderPage(app).goTo("twelves");
    await twelves.writeNote("edited in Twelves");
    await twelves.hearAgain();
    await expect(triage.root.getByText("edited in Twelves", { exact: true })).toBeVisible();
    await app.page.keyboard.press("e");
    await expect(triage.noteField).toHaveValue("edited in Twelves");
  },
);
