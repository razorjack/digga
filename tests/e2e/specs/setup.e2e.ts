import fs from "node:fs";
import path from "node:path";
import type {
  DecisionsExport,
  DumpsResponse,
  JobsResponse,
  Stats,
} from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatBytes, formatCount } from "../../../src/shared/display.ts";
import {
  DOWNLOAD_RETRIED_ERROR,
  INTERRUPTED_JOB_ERROR,
  type Job,
} from "../../../src/shared/types.ts";
import { DIG_THRESHOLD } from "../../../src/client/setup/model.ts";
import { BULK } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { type Picks, SetupPage } from "../pages/setup.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import type { FakeServices } from "../../../tools/dev/fake-services.ts";
import type { DiggaApp } from "../support/app.ts";
import { LiveRegionWatch } from "../support/live-regions.ts";
import { expect, test } from "../support/test.ts";

/** A new user's library, and data.discogs.com offering the bulk dump. */
const FIRST_RUN = { template: "empty", listedDump: "bulk" } as const;

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
      await setup.continueFromDiscogs(["collection", "wantlist"]);
      await setup.keepSuggestedStyles(["Drum n Bass"]);
      await setup.fillCrate();
      expect((await app.api.get<Config>("/api/settings")).sandbox).toBe(false);

      await setup.waitForRecordsToDig(point.recordsToDig);
      await setup.startDigging();
      const key = await triage.currentKey();
      await triage.judge("rejected");

      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "rejected" }),
      );
    },
  );

  test(
    "SETUP-01 Triage opened with T during the load digs the records counted, without looking again",
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
      // Paused, Triage cannot look again at the end of its queue; it reads the queue when shown.
      await app.clock.pause();
      await setup.fillCrate();
      await expect
        .poll(async () => (await app.api.get<Stats>("/api/stats")).remaining)
        .toBe(point.recordsToDig);
      await new HeaderPage(app).goTo("triage");

      await expect(new TriagePage(app).record).toBeVisible();
    },
  );

  test(
    "SETUP-31 at the end of what has loaded, Triage waits, and the next record shows once it arrives",
    { tag: ["@SETUP-31", "@P1"] },
    async ({ app, fakes }) => {
      test.slow();
      const point = fakes.dumps.checkpoint("100-to-dig");
      const later = fakes.dumps.checkpoint("600-to-dig");
      fakes.dumps.holdAt(point.name);
      const setup = new SetupPage(app);
      const triage = new TriagePage(app);
      const toDig = recordsToDigIn(ONE_YEAR, point.recordsToDig);

      await app.open();
      await setup.fetchCatalogue();
      await setup.skipDiscogs();
      await setup.makePicks(ONE_YEAR);
      await setup.fillCrate();
      await setup.waitForRecordsToDig(toDig);
      await new HeaderPage(app).goTo("triage");
      const passed: string[] = [];
      for (let index = 0; index < toDig; index += 1) {
        passed.push(await triage.currentKey());
        await triage.pass();
      }
      await expect(
        triage.root.getByText("You have dug everything loaded so far.", { exact: true }),
      ).toBeVisible();

      // Paused, only runFor() can make Triage look again.
      await app.clock.pause();
      fakes.dumps.release(later.name);
      await expect
        .poll(async () => (await app.api.get<Stats>("/api/stats")).remaining, {
          timeout: 15_000,
        })
        .toBe(recordsToDigIn(ONE_YEAR, later.recordsToDig));
      await expect(triage.record).toBeHidden();
      await app.clock.runFor(10_000);

      expect(passed).not.toContain(await triage.currentKey());
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
    const readFraction = point.offset / fakes.dumps.listed.bytes;
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

test(
  "SETUP-24 Change your picks stops the load, keeps what was dug, and step 3 starts from the picks",
  { tag: ["@SETUP-24", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const setup = new SetupPage(app);
    const header = new HeaderPage(app);
    const triage = new TriagePage(app);
    const picks: Picks = {
      styles: ["Drum n Bass", "Jungle"],
      span: [1997, 2003],
      vinylOnly: false,
    };

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();
    await setup.makePicks(picks);
    await setup.fillCrate();
    await setup.waitForRecordsToDig(point.recordsToDig);
    await header.goTo("triage");
    const judged = await triage.currentKey();
    await triage.judge("rejected");
    await header.loadIndicator.click();
    await setup.expectStep("crate");

    await setup.changePicks();
    await setup.expectPicks(picks);
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.find((job) => job.type === "dump_load")?.status).toBe("cancelled");
    // The judged release leaves the universe with the others, but stays with its verdict.
    expect((await app.api.get<Stats>("/api/stats")).universe.releases).toBe(0);
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts).toEqual([
      expect.objectContaining({ key: judged, status: "rejected", title: expect.any(String) }),
    ]);

    // A new page finds the cancelled load, and the way back to step 3 starts from the picks again.
    await setup.reload("crate");
    await expect(setup.alert(/^The catalogue stopped loading/)).toBeVisible();
    await setup.changePicks();
    await setup.expectPicks(picks);
  },
);

test(
  "SETUP-25 a download that stops under the load says where it stopped, keeps what loaded, and starts again",
  { tag: ["@SETUP-25", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const regions = await LiveRegionWatch.install(app.page);
    const header = new HeaderPage(app);
    const triage = new TriagePage(app);

    const setup = await fillTheCrate(app);
    // The load has read the records, so the download has written every byte sent.
    await setup.waitForRecordsToDig(point.recordsToDig);
    dropTransferAt(fakes, point.offset);

    await expect(setup.downloadStopped).toContainText(stoppedAt(fakes, point.offset));
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("The download stopped"),
    );
    // What loaded stays, and can be dug.
    expect((await app.api.get<Stats>("/api/stats")).remaining).toBe(point.recordsToDig);
    await header.goTo("triage");
    await expect(triage.record).toBeVisible();
    await app.open("#/setup");
    await expect(setup.downloadStopped).toBeVisible();

    fakes.dumps.set({ failAfterBytes: null });
    await setup.startLoadAgain();
    await setup.waitForCatalogue();
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.filter((job) => job.type === "dump_download").map((job) => job.status)).toEqual([
      "done",
      "failed",
    ]);
  },
);

test(
  "SETUP-25 a download that stops on steps 2 and 3 says where it stopped, and starts again",
  { tag: ["@SETUP-25", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const regions = await LiveRegionWatch.install(app.page);
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await expect.poll(() => partFileBytes(app, fakes)).toBe(point.offset);
    dropTransferAt(fakes, point.offset);
    await expect(setup.downloadStopped).toContainText(stoppedAt(fakes, point.offset));
    await expect(setup.downloadStrip).toBeHidden();
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("The download stopped"),
    );
    fakes.dumps.set({ failAfterBytes: null });
    fakes.dumps.holdAt(point.name);
    await setup.startDownloadAgain();

    await setup.skipDiscogs();
    await expect.poll(() => partFileBytes(app, fakes)).toBe(point.offset);
    dropTransferAt(fakes, point.offset);
    await expect(setup.downloadStopped).toContainText(stoppedAt(fakes, point.offset));
    await expect(setup.downloadStrip).toBeHidden();

    // Fill the crate downloads again, so the load has a dump to read.
    fakes.dumps.set({ failAfterBytes: null });
    fakes.dumps.holdAt(point.name);
    await setup.pickStyle("Drum n Bass");
    await setup.fillCrate();
    await setup.waitForRecordsToDig(point.recordsToDig);
    await expect(setup.downloadStopped).toBeHidden();
  },
);

test(
  "SETUP-26 a download that does not match Discogs' checksum comes once more by itself, and the load reads it again",
  { tag: ["@SETUP-26", "@P2"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.set({ wrongChecksums: 1 });
    fakes.dumps.holdAt(point.name, { transfer: 1 });
    const regions = await LiveRegionWatch.install(app.page);

    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(point.recordsToDig);
    // The first download ends with the wrong checksum; the second stops at the checkpoint.
    fakes.dumps.release();
    fakes.dumps.holdAt(point.name, { transfer: 2 });

    await expect(setup.checksumRetry).toContainText(
      "The download does not match Discogs' checksum, so Digga downloads it once more.",
    );
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("does not match"),
    );
    await expect.poll(() => jobStatuses(app, "dump_load")).toEqual(["running", "failed"]);
    fakes.dumps.release();

    await setup.waitForCatalogue();
    expect(fakes.dumps.transfers).toBe(2);
    expect(await jobStatuses(app, "dump_download")).toEqual(["done"]);
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.find((job) => job.type === "dump_load" && job.status === "failed")?.error).toBe(
      DOWNLOAD_RETRIED_ERROR,
    );
  },
);

test(
  "SETUP-26 a download that does not match Discogs' checksum twice asks before a third",
  { tag: ["@SETUP-26", "@P2"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.set({ wrongChecksums: 2 });
    fakes.dumps.holdAt(point.name, { transfer: 1 });

    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(point.recordsToDig);
    fakes.dumps.release();
    fakes.dumps.holdAt(point.name, { transfer: 2 });
    await expect(setup.checksumRetry).toBeVisible();
    // The second load reads the second download before it ends, as the first did.
    await expect.poll(() => jobStatuses(app, "dump_load")).toEqual(["running", "failed"]);
    fakes.dumps.release();

    await expect(setup.downloadStopped).toContainText(
      "The download does not match Discogs' checksum. Digga downloaded it twice.",
    );
    expect(fakes.dumps.transfers).toBe(2);
    expect(await jobStatuses(app, "dump_download")).toEqual(["failed"]);

    await setup.startLoadAgain();
    await setup.waitForCatalogue();
    expect(fakes.dumps.transfers).toBe(3);
  },
);

test(
  "SETUP-29 picks that match nothing offer Change your picks instead of digging",
  { tag: ["@SETUP-29", "@P2"] },
  async ({ app, fakes }) => {
    test.slow();
    // Held, so the load still reads when the crate shows.
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();
    // The bulk catalogue is all Drum n Bass.
    await setup.pickStyle("Jungle");
    await setup.fillCrate();
    fakes.dumps.release();

    await expect(setup.nothingMatches).toBeVisible({ timeout: 15_000 });
    await expect(setup.startDiggingButton).toBeHidden();
    await expect(setup.root.getByText(/^ready at/)).toBeHidden();
    await setup.changePicksAfterEmptyLoad();
    await expect(setup.removeButton("Jungle")).toBeVisible();

    await setup.removeStyle("Jungle");
    await setup.pickStyle("Drum n Bass");
    const loadStarted = app.page.waitForResponse(
      (response) => isRequest(response, "POST", "/api/jobs/dump-load") && response.ok(),
    );
    await setup.button("Fill the crate").click();
    await loadStarted;
    await setup.waitForCatalogue();
    await expect(setup.startDiggingButton).toBeEnabled();
    expect(await jobStatuses(app, "dump_load")).toEqual(["done", "done"]);
  },
);

test(
  "SETUP-23 the finished load: READY TO DIG, the heading that names the crate, one announcement, and Delete it",
  { tag: ["@SETUP-23", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const regions = await LiveRegionWatch.install(app.page);
    const header = new HeaderPage(app);
    const setup = await fillTheCrate(app);
    await setup.waitForCatalogue();

    const stats = await app.api.get<Stats>("/api/stats");
    const catalogueIn = `The catalogue is in: ${formatCount(stats.universe.releases)} releases, ${formatCount(stats.remaining)} records to dig.`;
    await expect(setup.catalogueIn).toHaveAccessibleName(catalogueIn);
    await expect(setup.root.getByRole("region", { name: catalogueIn })).toBeVisible();
    await expect(setup.root.getByText("ready to dig", { exact: true })).toBeVisible();
    await expect(header.announcement).toHaveText(catalogueIn);
    await expect(header.loadIndicator).toBeHidden();

    // A failed delete says why in the crate's alert, which was in the page before its text.
    const dumpPath = `/api/dumps/${fakes.dumps.listed.name}`;
    app.expectProblems({
      aborted: [new RegExp(`^DELETE ${dumpPath}$`)],
      consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
    });
    await app.abortRequests({ method: "DELETE", path: dumpPath });
    await setup.button("Delete it").click();
    await expect(setup.alert("Failed to fetch")).toBeVisible();
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("Failed to fetch"),
    );

    const deleted = app.page.waitForResponse((response) => isRequest(response, "DELETE", dumpPath));
    await setup.button("Delete it").click();
    expect((await deleted).ok()).toBe(true);
    await expect(
      setup.root.getByText("The catalogue file is deleted.", { exact: true }),
    ).toBeVisible();
    await expect(setup.alert("Failed to fetch")).toBeHidden();
    expect((await app.api.get<DumpsResponse>("/api/dumps")).files).toEqual([]);
    // Said once: the header's status still holds the one announcement.
    await expect(header.announcement).toHaveText(catalogueIn);
  },
);

test(
  "SETUP-27 Digga closing during the load leaves Pick up, which reads the dump from the start",
  { tag: ["@SETUP-27", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    // Only the first transfer waits; it ends with the server it was sending to.
    fakes.dumps.holdAt(point.name, { transfer: 1 });
    const setup = await fillTheCrate(app);
    await setup.waitForRecordsToDig(point.recordsToDig);

    await app.relaunch({ crash: true });
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.map((job) => [job.type, job.status, job.error])).toEqual(
      expect.arrayContaining([
        ["dump_download", "failed", INTERRUPTED_JOB_ERROR],
        ["dump_load", "failed", INTERRUPTED_JOB_ERROR],
      ]),
    );

    await app.open("#/setup");
    await setup.expectStep("crate");
    await setup.pickUp();
    await setup.waitForCatalogue();
    expect(fakes.dumps.transfers).toBe(2);
    expect(await jobStatuses(app, "dump_load")).toEqual(["done", "failed"]);
    // The new load read every release, the 100 the first one had read included.
    const after = await app.api.get<JobsResponse>("/api/jobs");
    const newestLoad = after.jobs.find((job) => job.type === "dump_load");
    expect(newestLoad).toMatchObject({ progress: { scanned: BULK.length } });
  },
);

test(
  "SETUP-33 a load that ends with fewer than 500 records to dig enables Start digging",
  { tag: ["@SETUP-33", "@P1"] },
  async ({ app }) => {
    test.slow();
    const toDig = recordsToDigIn(ONE_YEAR, BULK.length);
    expect(toDig).toBeLessThan(DIG_THRESHOLD);
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();
    await setup.makePicks(ONE_YEAR);
    await setup.fillCrate();
    await setup.waitForCatalogue();

    await expect(setup.recordsToDig(toDig)).toBeVisible();
    await expect(setup.root.getByText(/^ready at/)).toBeHidden();
    await setup.startDigging();
  },
);

/** Drum n Bass on vinyl from 1998 alone, which keeps fewer than 500 of the bulk records to dig. */
const ONE_YEAR: Picks = { styles: ["Drum n Bass"], span: [1998, 1998], vinylOnly: true };

/** The records to dig among the first `releases` of the bulk dump, under picks of one style. */
function recordsToDigIn(picks: Picks, releases: number): number {
  return BULK.slice(0, releases).filter(
    (release) =>
      release.year !== null && release.year >= picks.span[0] && release.year <= picks.span[1],
  ).length;
}

/** The statuses of the jobs of one type, newest first. */
async function jobStatuses(app: DiggaApp, type: Job["type"]): Promise<Job["status"][]> {
  const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
  return jobs.filter((job) => job.type === type).map((job) => job.status);
}

/** A held transfer closes its connection where it waits, as a dropped download does. */
function dropTransferAt(fakes: FakeServices, offset: number): void {
  expect(fakes.dumps.sentBytes).toBe(offset);
  fakes.dumps.set({ failAfterBytes: offset });
  fakes.dumps.release();
}

/** What the setup says of a download dropped after `offset` bytes; Node names the reason. */
function stoppedAt(fakes: FakeServices, offset: number): RegExp {
  const where = `${formatBytes(offset)} of ${formatBytes(fakes.dumps.listed.bytes)}`.replaceAll(
    ".",
    "\\.",
  );
  return new RegExp(
    `^The download stopped at ${where}: [^.]+\\. Discogs does not allow resuming, so it starts again\\.`,
  );
}

/**
 * What the download has written to its part file: the bytes it has taken from the transfer,
 * which the job's progress reports at most once a second.
 */
function partFileBytes(app: DiggaApp, fakes: FakeServices): number {
  const part = path.join(app.library.dumpsDir, `${fakes.dumps.listed.name}.part`);
  return fs.existsSync(part) ? fs.statSync(part).size : 0;
}

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
