import type {
  DecisionsExport,
  DumpsResponse,
  JobsResponse,
  Stats,
} from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { HeaderPage } from "../pages/header.ts";
import { SetupPage } from "../pages/setup.ts";
import { TriagePage } from "../pages/triage.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

/** A new user's library, and data.discogs.com offering the bulk dump. */
const FIRST_RUN = { template: "empty", listedDump: "bulk" } as const;

/** While a load runs, Triage looks for new records at the end of its queue every 10 s. */
const LOOK_AGAIN_MS = 10_000;

test.use({ diggaOptions: FIRST_RUN });

test.describe("with the clock", () => {
  test.use({ diggaOptions: { ...FIRST_RUN, clock: true } });

  test(
    "SETUP-01 the first run from the default config ends with a saved verdict",
    { tag: ["@SETUP-01", "@P0"] },
    async ({ app, fakes }) => {
      test.slow();
      const point = fakes.dumps.checkpoint("600-to-dig");
      fakes.dumps.holdAt(point.name);
      expect((await app.api.get<Config>("/api/settings")).sandbox).toBe(true);
      const setup = new SetupPage(app);
      const triage = new TriagePage(app);

      await app.open();
      await setup.fetchCatalogue();
      await setup.connect("e2e-token-dj");
      await setup.continueFromDiscogs();
      await setup.keepSuggestedStyles(["Drum n Bass"]);
      await setup.fillCrate();
      expect((await app.api.get<Config>("/api/settings")).sandbox).toBe(false);

      await setup.waitForRecordsToDig(point.recordsToDig);
      await setup.startDigging();
      // Gap: Triage digs the queue it read when the picks were saved, before the first records
      // came, until it looks again.
      await app.clock.runFor(LOOK_AGAIN_MS);
      const key = await triage.currentKey();
      await triage.judge("rejected");

      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "rejected" }),
      );
    },
  );

  test.fail(
    "SETUP-01 gap: Triage opened during the load digs the records counted, without looking again",
    { tag: ["@SETUP-01", "@P0"] },
    async ({ app, fakes }) => {
      test.slow();
      const point = fakes.dumps.checkpoint("100-to-dig");
      fakes.dumps.holdAt(point.name);
      const setup = new SetupPage(app);

      await app.open();
      await setup.fetchCatalogue();
      await setup.skipDiscogs();
      await setup.pickStyle("Drum n Bass");
      // Paused, Triage cannot look again: it has only the queue it reads when the picks are saved.
      await app.clock.pause();
      await setup.fillCrate();
      await expect
        .poll(async () => (await app.api.get<Stats>("/api/stats")).remaining)
        .toBe(point.recordsToDig);
      await new HeaderPage(app).goTo("triage");

      await expect(new TriagePage(app).record).toBeVisible();
    },
  );
});

test(
  "SETUP-18 held at a checkpoint, the crate shows what the load has read",
  { tag: ["@SETUP-18", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const readFraction = point.offset / fakes.dumps.listed.data.length;
    const header = new HeaderPage(app);

    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(point.recordsToDig);

    await expect(setup.releasesKept(point.recordsToDig)).toBeVisible();
    await expect(setup.progress("Read")).toHaveJSProperty("value", readFraction);
    await expect(setup.progress("Download")).not.toHaveJSProperty("position", -1);
    await expect(setup.root.getByText("Just pulled", { exact: true })).toBeVisible();
    const { last } = point;
    await expect(
      setup.root.getByText(`${last.artists[0]!} – ${last.title}`, { exact: true }),
    ).toBeVisible();
    await expect(setup.root.getByText(last.label.catno, { exact: true })).toBeVisible();
    await expect(header.loadIndicator).toHaveAccessibleName(
      `loading ${Math.floor(readFraction * 100)}%`,
    );

    await header.goTo("settings");
    await header.goTo("twelves");
  },
);

test(
  "SETUP-19 held at a checkpoint, the load counts the records the download has brought so far",
  { tag: ["@SETUP-19", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);

    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(point.recordsToDig);

    expect((await app.api.get<Stats>("/api/stats")).remaining).toBe(point.recordsToDig);
    expect(fakes.dumps.sentBytes).toBe(point.offset);
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.filter((job) => job.status === "running").map((job) => job.type)).toEqual(
      expect.arrayContaining(["dump_download", "dump_load"]),
    );
    // The dump is still a .part file, which the dumps folder does not list.
    expect((await app.api.get<DumpsResponse>("/api/dumps")).files).toEqual([]);
  },
);

test(
  "SETUP-21 Start digging waits for 500 records to dig, while T opens Triage at any count",
  { tag: ["@SETUP-21", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const early = fakes.dumps.checkpoint("100-to-dig");
    const enough = fakes.dumps.checkpoint("600-to-dig");
    fakes.dumps.holdAt(early.name);
    const header = new HeaderPage(app);
    const readyAt = "ready at 500 records";

    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(early.recordsToDig);
    await expect(setup.startDiggingButton).toBeDisabled();
    await expect(setup.root.getByText(readyAt, { exact: true })).toBeVisible();

    await header.goTo("triage");
    await header.loadIndicator.click();
    await expect(setup.heading("crate")).toBeVisible();

    fakes.dumps.release(enough.name);
    await setup.waitForRecordsToDig(enough.recordsToDig);
    await expect(setup.startDiggingButton).toBeEnabled();
    await expect(setup.root.getByText(readyAt, { exact: true })).toBeHidden();

    await app.page.keyboard.press("Enter");
    await expect(header.link("triage")).toHaveAttribute("aria-current", "page");
    await expect(header.sandbox).toBeHidden();
    expect((await app.api.get<Config>("/api/settings")).sandbox).toBe(false);

    await header.loadIndicator.click();
    await setup.startDigging();
  },
);

/** The setup up to the crate without a Discogs account, with the picks SETUP-01 makes. */
async function fillTheCrate(app: DiggaApp): Promise<SetupPage> {
  const setup = new SetupPage(app);
  await app.open();
  await setup.fetchCatalogue();
  await setup.skipDiscogs();
  await setup.pickStyle("Drum n Bass");
  await setup.fillCrate();
  return setup;
}
