import type { Locator, Page } from "@playwright/test";
import { STATUS_COPY } from "../../../src/client/keymap.ts";
import { SETTINGS_TAB_LABEL, type SettingsTab } from "../../../src/client/settings/tabs.ts";
import { endOfQueueHeadline } from "../../../src/client/triage/end-of-queue.ts";
import { SHELVES } from "../../../src/client/twelves/model.ts";
import type { Stats } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import {
  ECHO_CHAMBER,
  EVENT_HORIZON,
  FIRST_RECORD,
  GROUNDWORK,
  SECOND_RECORD,
  THIRD_RECORD,
  TRACK_RUN,
  WITHOUT_VIDEOS,
} from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { KeysDialog, PracticeCard } from "../pages/dialogs.ts";
import { HeaderPage, page } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { SetupPage, type SetupStep, stepTitle } from "../pages/setup.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expectAccessible } from "../support/axe.ts";
import { LiveRegionWatch } from "../support/live-regions.ts";
import { expect, test } from "../support/test.ts";

// Accessibility: axe scans of each screen and the names of its regions, inert players, live
// regions and document titles
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
      await expectAccessible(app.page, "Settings, Digging");

      const regions: [SettingsTab, Locator[]][] = [
        ["library", [settings.library, settings.dumpSection]],
        ["discogs", [settings.discogs, settings.imports]],
        ["backups", [settings.backups, settings.exports]],
        ["general", [settings.sandbox]],
      ];
      for (const [tab, shown] of regions) {
        await settings.showTab(tab);
        for (const region of shown) await expect(region).toBeVisible();
        await expectAccessible(app.page, `Settings, ${SETTINGS_TAB_LABEL[tab]}`);
      }
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

test.describe("a record with a run of tracks", () => {
  test.use({ diggaOptions: { labels: [GROUNDWORK.name] } });

  test(
    "A11Y-02 the players are inert, Tab never reaches one, and a clicked control leaves the page keys working",
    { tag: ["@A11Y-02", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      await app.open();
      await triage.startListening();

      const frames = triage.player.locator("iframe");
      await expect(frames).toHaveCount(3);
      expect(await insideInert(frames)).toEqual([true, true, true]);
      // Focus inside a player's frame would make the frame the page's active element.
      const reached = await tabRound(app.page);
      expect(reached).not.toContainEqual(expect.stringMatching(/^IFRAME/));
      expect(reached.length).toBeGreaterThan(1);
      // The round leaves the focus on the last control it reached.
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      // A clicked button or link does not take the focus, so Enter and Space stay the page's;
      // the slider takes it, and leaves every key to the page.
      await triage.track(TRACK_RUN.tracks[1]!.position).getByRole("button").click();
      expect(await focused(app.page)).toBe("BODY");
      await expect(triage.currentTrack).toHaveAttribute(
        "data-position",
        TRACK_RUN.tracks[1]!.position,
      );
      expect(await triage.previousTrack()).toBe(TRACK_RUN.tracks[0]!.position);

      await header.link("twelves").click();
      await expect(header.link("twelves")).toHaveAttribute("aria-current", "page");
      expect(await focused(app.page)).toBe("BODY");
      await header.goTo("triage");

      await triage.root.locator('[aria-keyshortcuts="N"]').click();
      expect(await focused(app.page)).toBe("BODY");
      await triage.goRound();

      await triage.position.click();
      await triage.pause();
    },
  );
});

/** For each element, whether an `inert` ancestor, or the element itself, holds it. */
function insideInert(elements: Locator): Promise<boolean[]> {
  return elements.evaluateAll((list) => list.map((element) => element.closest("[inert]") !== null));
}

/** The focused element as "TAG name", or "BODY" when nothing has the focus. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "BODY";
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
    return `${element.tagName} ${name}`.slice(0, 80);
  });
}

/**
 * Presses Tab until the focus comes back to an element it reached before, at most 60 times;
 * returns what each press reached, as "TAG name".
 */
async function tabRound(page: Page): Promise<string[]> {
  const reached: string[] = [];
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    if (reached.includes(now)) break;
    reached.push(now);
  }
  return reached;
}

test.describe("with the September dump listed", () => {
  test.use({ diggaOptions: { listedDump: "september" } });

  test(
    "A11Y-03 the slip, the flashes and the header's status are in the page before their text",
    { tag: ["@A11Y-03", "@P2"] },
    async ({ app, fakes }) => {
      const regions = await LiveRegionWatch.install(app.page);
      const triage = new TriagePage(app);
      const settings = new SettingsPage(app);
      const twelves = new TwelvesPage(app);
      const header = new HeaderPage(app);
      await app.open();
      await expect(triage.lastAction).toHaveText(/\S/);
      await expect(header.announcement).toHaveText("");

      // A snooze, which Twelves shows on Everything, where the note goes.
      await triage.judge("snoozed");
      await expect(triage.lastAction).toContainText(STATUS_COPY.snoozed);
      await app.page.keyboard.press("m");
      await expect(triage.messages).toHaveText(/^M needs your Discogs Maybe list/);

      await twelves.open();
      await twelves.writeNote("rolling bassline");

      await settings.open("library");
      fakes.dumps.holdAt("part-way");
      const update = await settings.startJob(
        settings.dumpSection.getByRole("button", { name: "Update from the newest dump" }),
      );
      await expect(header.loadIndicator).toBeVisible();
      fakes.dumps.release();
      await settings.waitForJob(update, "done");
      await expect(header.announcement).toHaveText(/^The catalogue is in: /);
      await settings.switchSandbox("on");

      const inserted = await regions.insertedWithText();
      for (const text of [
        STATUS_COPY.snoozed,
        "M needs your Discogs Maybe list",
        "Note saved.",
        "The catalogue is in",
        "Back in the sandbox",
      ])
        expect(inserted).not.toContainEqual(expect.stringContaining(text));
    },
  );
});

test("A11Y-04 each page sets the document title", { tag: ["@A11Y-04", "@P1"] }, async ({ app }) => {
  const header = new HeaderPage(app);
  await app.open();
  await expect(app.page).toHaveTitle(`${page("triage").label} – Digga`);

  for (const route of ["twelves", "settings", "triage"] as const) {
    await header.goTo(route);
    await expect(app.page).toHaveTitle(`${page(route).label} – Digga`);
  }
});

test.describe("the first run's titles", () => {
  test.use({ diggaOptions: { template: "empty", listedDump: "bulk" } });

  test(
    "A11Y-04 each setup step sets the document title",
    { tag: ["@A11Y-04", "@P1"] },
    async ({ app, fakes }) => {
      test.slow();
      fakes.dumps.holdAt(fakes.dumps.checkpoint("100-to-dig").name);
      const setup = new SetupPage(app);
      const title = (step: SetupStep) => `${stepTitle(step)} – Digga setup`;

      await app.open();
      await setup.expectStep("catalogue");
      await expect(app.page).toHaveTitle(title("catalogue"));
      await setup.fetchCatalogue();
      await expect(app.page).toHaveTitle(title("discogs"));
      await setup.skipDiscogs();
      await expect(app.page).toHaveTitle(title("sound"));
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();
      await expect(app.page).toHaveTitle(title("crate"));
    },
  );
});

test(
  "A11Y-05 the scope picker's dig button declares Enter",
  { tag: ["@A11Y-05", "@P2"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    await triage.openScopePicker();

    await expect(triage.scopePicker.getByRole("button", { name: "dig" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Enter",
    );
  },
);

test.describe("the crate", () => {
  test.use({ diggaOptions: { template: "empty", listedDump: "bulk" } });

  test(
    "A11Y-05 the crate's Start digging declares T and Enter",
    { tag: ["@A11Y-05", "@P2"] },
    async ({ app, fakes }) => {
      test.slow();
      fakes.dumps.holdAt(fakes.dumps.checkpoint("100-to-dig").name);
      const setup = new SetupPage(app);
      await app.open();
      await setup.fetchCatalogue();
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      await setup.fillCrate();

      await expect(setup.startDiggingButton).toHaveAttribute("aria-keyshortcuts", "T Enter");
    },
  );
});

test.describe("a narrow window in the sandbox", () => {
  test.use({ diggaOptions: { sandbox: true } });

  test(
    "A11Y-06 the header hides the sandbox's explanation and the ETA from sight only",
    { tag: ["@A11Y-06", "@P2"] },
    async ({ app }) => {
      const header = new HeaderPage(app);
      await app.open();
      await expect(header.root.getByText("ETA after a few verdicts")).toBeVisible();
      await app.page.setViewportSize({ width: 1100, height: 1000 });

      const explanation = header.sandbox.getByText("verdicts are not saved", { exact: true });
      const eta = header.root.getByText("ETA after a few verdicts", { exact: true });
      for (const hidden of [explanation, eta])
        await expect.poll(async () => (await hidden.boundingBox())?.width).toBe(1);
      await expect(header.sandbox).toHaveAccessibleName(/verdicts are not saved/);
      await expect(header.root).toMatchAriaSnapshot("- paragraph: ETA after a few verdicts");
    },
  );
});
