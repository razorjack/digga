import { endOfQueueHeadline } from "../../../src/client/triage/end-of-queue.ts";
import { SHELVES } from "../../../src/client/twelves/model.ts";
import type { Stats } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import {
  ECHO_CHAMBER,
  EVENT_HORIZON,
  FIRST_RECORD,
  SECOND_RECORD,
  THIRD_RECORD,
  WITHOUT_VIDEOS,
} from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { KeysDialog, PracticeCard } from "../pages/dialogs.ts";
import { SettingsPage } from "../pages/settings.ts";
import { SetupPage } from "../pages/setup.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expectAccessible } from "../support/axe.ts";
import { expect, test } from "../support/test.ts";

// Accessibility: axe scans of each screen and the names of its regions
// (docs/e2e/scenarios/accessibility.md).

test.describe("A11Y-01 axe finds nothing serious", () => {
  test(
    "A11Y-01 Triage playing, the Keys dialog and the scope picker",
    { tag: ["@A11Y-01", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const keys = new KeysDialog(app);
      await app.open();
      await triage.startListening();

      await expect(triage.player).toBeVisible();
      await expect(triage.lastAction).toBeVisible();
      await expect(triage.upNext).toBeVisible();
      await expect(triage.root.getByRole("group", { name: "Verdicts" })).toBeVisible();
      await expect(triage.messages).toBeAttached();
      await expect(triage.notices).toBeAttached();
      await expectAccessible(app.page, "Triage playing");

      await keys.open();
      await expectAccessible(app.page, "the Keys dialog");
      await keys.close("escape");

      await triage.openScopePicker();
      await expect(triage.scopePicker.getByRole("radio").first()).toBeVisible();
      await expectAccessible(app.page, "the scope picker");
    },
  );

  test.describe("a label whose second record has no videos", () => {
    test.use({ diggaOptions: { labels: [ECHO_CHAMBER.name] } });

    test("A11Y-01 Triage with no audio", { tag: ["@A11Y-01", "@P1"] }, async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();
      await triage.pass();
      await expect(triage.playerStatus("no_audio")).toBeVisible();

      await expectAccessible(app.page, "Triage with no audio");
    });
  });

  test.describe("a label of two records", () => {
    test.use({ diggaOptions: { labels: ["Bassline Theory"] } });

    test(
      "A11Y-01 Triage at the end of the queue",
      { tag: ["@A11Y-01", "@P1"] },
      async ({ app }) => {
        const triage = new TriagePage(app);
        await app.open();
        await triage.judge("rejected");
        await triage.judge("rejected");

        await expect(triage.root.getByText(endOfQueueHeadline(0), { exact: true })).toBeVisible();
        await expectAccessible(app.page, "Triage at the end of the queue");
      },
    );
  });

  test.describe("on an account's library", () => {
    test.use({ diggaOptions: { template: "small-account" } });

    test("A11Y-01 each Twelves shelf", { tag: ["@A11Y-01", "@P1"] }, async ({ app }) => {
      const twelves = new TwelvesPage(app);
      await app.given.verdicts(
        datedVerdicts([
          { release: FIRST_RECORD, status: "accepted" },
          { release: SECOND_RECORD, status: "maybe" },
          { release: THIRD_RECORD, status: "snoozed" },
          { release: EVENT_HORIZON, status: "candidate" },
          { release: WITHOUT_VIDEOS, status: "no_audio" },
        ]),
      );
      await app.given.trackMark({
        releaseId: FIRST_RECORD.id,
        position: FIRST_RECORD.tracks[0]!.position,
        mark: "keep",
      });
      await twelves.open();

      for (const shelf of SHELVES) {
        await twelves.showShelf(shelf.id);
        await expect(twelves.shelf(shelf.id).getByRole("row").nth(1)).toBeVisible();
        // The record shelves share one table; Everything and Tracks cover the light scheme.
        await expectAccessible(app.page, `the ${shelf.label} shelf`, {
          lightScheme: shelf.id === "all" || shelf.id === "tracks",
        });
      }
    });

    test("A11Y-01 Settings", { tag: ["@A11Y-01", "@P1"] }, async ({ app }) => {
      const settings = new SettingsPage(app);
      await settings.open();
      await expect(settings.preview).toBeVisible();

      for (const region of [
        settings.sandbox,
        settings.library,
        settings.exports,
        settings.discogs,
        settings.jobs,
      ])
        await expect(region).toBeVisible();
      await expectAccessible(app.page, "Settings");
    });
  });

  test.describe("the first run", () => {
    test.use({ diggaOptions: { template: "empty", listedDump: "bulk" } });

    test(
      "A11Y-01 each setup step, the crate while it loads and once it is in, and the practice card",
      { tag: ["@A11Y-01", "@P1"] },
      async ({ app, fakes }) => {
        test.slow();
        const point = fakes.dumps.checkpoint("100-to-dig");
        fakes.dumps.holdAt(point.name);
        const setup = new SetupPage(app);
        const triage = new TriagePage(app);
        const card = new PracticeCard(app);

        await app.open();
        await expect(setup.button("Fetch the catalogue")).toBeEnabled();
        await expectStepRegion(setup, "catalogue", "Dig every record in your styles, by ear.");
        await expectAccessible(app.page, "the setup's step 1");

        await setup.fetchCatalogue();
        await setup.connect("e2e-token-dj");
        await expectStepRegion(setup, "discogs", "Bring your Discogs");
        await expect(setup.downloadStrip).toBeVisible();
        await expectAccessible(app.page, "the setup's step 2");

        await setup.continueFromDiscogs(["collection", "wantlist"]);
        await setup.keepSuggestedStyles(["Drum n Bass"]);
        await expect(setup.estimate).toBeVisible();
        await expect(setup.root.getByRole("form", { name: "Pick your sound" })).toBeVisible();
        await expectAccessible(app.page, "the setup's step 3");

        await setup.fillCrate();
        await setup.waitForRecordsToDig(point.recordsToDig);
        await expect(setup.root.getByRole("region", { name: "Fill the crate" })).toBeVisible();
        await expectAccessible(app.page, "the crate while it loads");

        fakes.dumps.release();
        await setup.waitForCatalogue();
        const stats = await app.api.get<Stats>("/api/stats");
        await expect(
          setup.root.getByRole("region", {
            name: `The catalogue is in: ${formatCount(stats.universe.releases)} releases, ${formatCount(stats.remaining)} records to dig.`,
          }),
        ).toBeVisible();
        await expectAccessible(app.page, "the crate once the catalogue is in");

        await setup.practice();
        for (let index = 0; index < 5; index += 1) await triage.judgeInSandbox("rejected");
        await expect(card.root).toBeVisible();
        await expectAccessible(app.page, "the practice card");
      },
    );
  });
});

/** The step's region carries the name of its heading. */
async function expectStepRegion(
  setup: SetupPage,
  step: "catalogue" | "discogs",
  name: string,
): Promise<void> {
  await setup.expectStep(step);
  await expect(setup.root.getByRole("region", { name })).toBeVisible();
}
