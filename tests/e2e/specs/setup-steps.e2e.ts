import fs from "node:fs";
import path from "node:path";
import { formatDumpDate, homeRelative } from "../../../src/client/setup/model.ts";
import { ROUTES } from "../../../src/client/routes.ts";
import { SPARE_BYTES } from "../../../src/server/jobs/dump-download.ts";
import type { DiscogsAccountResponse, JobsResponse } from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatBytes } from "../../../src/shared/display.ts";
import type { FakeServices } from "../../../tools/dev/fake-services.ts";
import { HeaderPage } from "../pages/header.ts";
import { SetupPage, stepTitle } from "../pages/setup.ts";
import { LiveRegionWatch } from "../support/live-regions.ts";
import { expect, test } from "../support/test.ts";

/** A new user's library, and data.discogs.com offering the bulk dump. */
const FIRST_RUN = { template: "empty", listedDump: "bulk" } as const;

test.use({ diggaOptions: FIRST_RUN });

test(
  "SETUP-02 an empty library opens the first step, with the header to itself",
  { tag: ["@SETUP-02", "@P1"] },
  async ({ app }) => {
    const setup = new SetupPage(app);
    const header = new HeaderPage(app);

    await app.open();
    await setup.expectStep("catalogue");

    await expect(app.page).toHaveTitle(`${stepTitle("catalogue")} – Digga setup`);
    await expect(header.root.getByRole("link")).toHaveCount(0);
    await expect(header.pages).toBeHidden();
    // A page key sets the hash inside its keydown handler, so the hash is exact once the press returns.
    for (const route of ROUTES) {
      await app.page.keyboard.press(route.key.toLowerCase());
      expect(await app.page.evaluate(() => location.hash), route.key).toBe("#/setup/catalogue");
    }
  },
);

test(
  "SETUP-03 step 1 states the catalogue's date, size, folder and free space before anything downloads",
  { tag: ["@SETUP-03", "@P1"] },
  async ({ app, fakes }) => {
    const setup = new SetupPage(app);
    const dump = fakes.dumps.listed;

    await app.open();
    // The listing rounds the size to a tenth of a KB, which formatBytes rounds away again.
    await expect(catalogueLine(setup)).toContainText(
      `from ${formatDumpDate(dump.date)}: ${formatBytes(dump.bytes)}, into ` +
        homeRelative(app.library.dumpsDir),
    );
    // The disk is the machine's own (docs/e2e/HARNESS.md#disk-space), so only its shape is known.
    await expect(catalogueLine(setup)).toContainText(/\(\d+(\.\d)? (B|KB|MB|GB) free\)\./);
    expect(dumpDownloads(fakes)).toEqual([]);
    expect(app.apiRequests()).not.toContain("POST /api/jobs/dump-download");

    await setup.fetchCatalogue();
    await expect.poll(() => dumpDownloads(fakes)).toEqual([dump.name]);
  },
);

test(
  "SETUP-04 with data.discogs.com down, step 1 gives the reason, and Try again finds the catalogue",
  { tag: ["@SETUP-04", "@P1"] },
  async ({ app, fakes }) => {
    fakes.dumps.set({ unavailableStatus: 503 });
    const regions = await LiveRegionWatch.install(app.page);
    const setup = new SetupPage(app);
    const reason = /^Digga can't reach data\.discogs\.com: .+ answered 503\.$/;

    await app.open();
    await expect(setup.root.getByText(reason)).toBeVisible();
    await expect(setup.button("Fetch the catalogue")).toBeHidden();

    fakes.dumps.set({ unavailableStatus: null });
    await setup.readCatalogueAgain("Try again");
    await expect(setup.button("Fetch the catalogue")).toBeEnabled();
    await expect(catalogueLine(setup)).toContainText(formatDumpDate(fakes.dumps.listed.date));
    await expect(setup.button("Try again")).toBeHidden();
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("can't reach"),
    );
  },
);

test(
  "SETUP-05 a catalogue larger than the free space disables Fetch and says how to make room",
  { tag: ["@SETUP-05", "@P1"] },
  async ({ app, fakes }) => {
    // More than any disk has, so the real free space is short whatever the machine.
    const listedBytes = 900 * 1024 ** 4;
    fakes.dumps.list(fakes.dumps.listed, { listedBytes });
    const regions = await LiveRegionWatch.install(app.page);
    const setup = new SetupPage(app);
    const alert = setup.alert(/^The catalogue needs/);

    await app.open();
    await expect(alert).toContainText(
      `The catalogue needs ${formatBytes(listedBytes + SPARE_BYTES)} free, counting 1 GB to spare`,
    );
    await expect(alert).toContainText(homeRelative(app.library.dumpsDir));
    await expect(alert).toContainText("set DIGGA_DUMPS_DIR in .env and start Digga again");
    await expect(setup.button("Fetch the catalogue")).toBeDisabled();
    // The desktop app offers no other folder while DIGGA_DUMPS_DIR names this one.
    await expect(setup.button("Choose a folder…")).toBeHidden();

    await setup.readCatalogueAgain("Check again");
    await expect(alert).toBeVisible();
    await expect(setup.button("Fetch the catalogue")).toBeDisabled();
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("The catalogue needs"),
    );
  },
);

test(
  "SETUP-32 a download that finds too little space stops before it writes a byte, and the step says why",
  { tag: ["@SETUP-32", "@P2"] },
  async ({ app, fakes }) => {
    // The listing fits on any disk; the transfer then announces more than any disk has.
    const announcedBytes = 900 * 1024 ** 4;
    fakes.dumps.list(fakes.dumps.listed, { listedBytes: 2 * 1024 ** 2 });
    fakes.dumps.set({ contentLength: announcedBytes });
    const regions = await LiveRegionWatch.install(app.page);
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();

    await expect(setup.downloadStopped).toContainText(
      `The download stopped: The dump needs ${formatBytes(announcedBytes + SPARE_BYTES)} free in ` +
        `${app.library.dumpsDir}, counting 1 GB to spare; it has `,
    );
    await expect(setup.downloadStrip).toBeHidden();
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("The download stopped"),
    );
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.map((job) => [job.type, job.status])).toEqual([["dump_download", "failed"]]);
    expect(fs.readdirSync(app.library.dumpsDir)).toEqual([]);
  },
);

test.describe("with the catalogue in the dumps folder", () => {
  test.use({
    diggaOptions: { template: "empty", listedDump: "september", dumpFiles: ["september"] },
  });

  test(
    "SETUP-06 a catalogue already downloaded is kept, and Continue moves on without a download",
    { tag: ["@SETUP-06", "@P1"] },
    async ({ app, fakes }) => {
      const setup = new SetupPage(app);

      await app.open();
      await expect(
        setup.root.getByText("Digga has the 1 September 2026 catalogue already.", { exact: true }),
      ).toBeVisible();
      await setup.continueFromCatalogue();

      expect(app.apiRequests()).not.toContain("POST /api/jobs/dump-download");
      expect(dumpDownloads(fakes)).toEqual([]);
      await expect(setup.downloadStrip).toBeHidden();
    },
  );
});

test(
  "SETUP-07 the download runs behind steps 2 and 3, which keep their step over a reload and go back",
  { tag: ["@SETUP-07", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    fakes.dumps.holdAt(fakes.dumps.checkpoint("100-to-dig").name);
    const setup = new SetupPage(app);
    const progress = setup.downloadStrip.getByRole("progressbar", { name: "Catalogue downloaded" });

    await app.open();
    await setup.fetchCatalogue();
    await expect(progress).toBeVisible();
    await setup.reload("discogs");
    await expect(progress).toBeVisible();

    await setup.skipDiscogs();
    await expect(progress).toBeVisible();
    await setup.reload("sound");
    await expect(progress).toBeVisible();

    await setup.back("discogs");
    await setup.back("catalogue");
    await expect(
      setup.root.getByText("The catalogue is downloading.", { exact: true }),
    ).toBeVisible();
    await expect(setup.downloadStrip).toBeHidden();
    expect(dumpDownloads(fakes)).toEqual([fakes.dumps.listed.name]);
  },
);

test(
  "SETUP-11 Skip moves to step 3 with nothing connected and nothing suggested",
  { tag: ["@SETUP-11", "@P1"] },
  async ({ app, fakes }) => {
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();

    // The census and the setup's tally have both arrived once the search shows.
    await expect(setup.styleSearch).toBeVisible();
    await expect(setup.suggestion).toBeHidden();
    await expect(setup.pickedStyles).toBeHidden();
    await expect(setup.years.getByText("Pick a style to see its years.")).toBeVisible();
    const account = await app.api.get<DiscogsAccountResponse>("/api/discogs/account");
    expect(account).toMatchObject({ username: "", hasToken: false });
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.map((job) => job.type)).toEqual(["dump_download"]);
    expect(fakes.log.filter((request) => request.service === "discogs")).toEqual([]);
  },
);

test(
  "SETUP-15 the style picker finds, suggests, removes and lists styles; the years have their options",
  { tag: ["@SETUP-15", "@P1"] },
  async ({ app }) => {
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();

    await setup.pickStyle("Jungle", "jung");
    await setup.addOftenTagged("Drum n Bass");
    await setup.removeStyle("Jungle");
    await expect(setup.pickedStyles.getByRole("listitem")).toHaveCount(1);
    await expect(setup.removeButton("Drum n Bass")).toBeVisible();

    await expect(setup.genreStyles("Electronic")).toBeHidden();
    await setup.openGenre("Electronic");
    const electronic = setup.genreStyles("Electronic");
    await expect(
      electronic.getByRole("checkbox", { name: styleWithCount("Drum n Bass") }),
    ).toBeChecked();
    await electronic.getByRole("checkbox", { name: styleWithCount("Breakbeat") }).check();
    await expect(setup.removeButton("Breakbeat")).toBeVisible();

    await expect(setup.estimate).toContainText(" on vinyl.");
    await setup.setVinylOnly(false);
    await expect(setup.estimate).not.toContainText(" on vinyl.");

    const from = Number(await setup.yearField("from").inputValue());
    const to = Number(await setup.yearField("to").inputValue());
    await expect(setup.yearField("from", { load: true })).toBeHidden();
    await setup.openLoadYears();
    await expect(setup.yearField("from", { load: true })).toHaveValue(String(from - 3));
    await expect(setup.yearField("to", { load: true })).toHaveValue(String(to + 3));
    await setup.setYear("from", from - 10, { load: true });
    await expect(setup.loadYearsSummary).toContainText(`Digga loads ${from - 10}–${to + 3}`);
  },
);

test(
  "SETUP-16 Fill the crate needs a style and a span that runs forwards",
  { tag: ["@SETUP-16", "@P1"] },
  async ({ app }) => {
    const setup = new SetupPage(app);
    const hint = "Enter picks the first match. Pick as many as you like.";

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();
    await expect(setup.styleSearch).toBeVisible();

    await setup.fillCrateWithoutStyles();
    await expect(setup.styleSearch).toHaveAccessibleDescription(`${hint} Pick at least one style`);
    await expect(setup.root.getByText("Pick at least one style", { exact: true })).toBeVisible();
    await setup.expectStep("sound");
    expect(app.apiRequests()).not.toContain("PUT /api/settings");

    await setup.pickStyle("Drum n Bass");
    await expect(setup.styleSearch).not.toHaveAttribute("aria-invalid");
    await expect(setup.styleSearch).toHaveAccessibleDescription(hint);
    await expect(setup.root.getByText("Pick at least one style", { exact: true })).toBeHidden();

    const to = Number(await setup.yearField("to").inputValue());
    await expect(setup.yearField("from")).toHaveAttribute("max", String(to));
    await setup.setYear("from", to + 1);
    await setup.button("Fill the crate").click();
    const overflow = await setup
      .yearField("from")
      .evaluate((input: HTMLInputElement) => input.validity.rangeOverflow);
    expect(overflow).toBe(true);
    await setup.expectStep("sound");
    expect(app.apiRequests()).not.toContain("PUT /api/settings");
  },
);

test(
  "SETUP-17 Fill the crate saves the styles, years, formats and load years and starts the load",
  { tag: ["@SETUP-17", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    fakes.dumps.holdAt(fakes.dumps.checkpoint("100-to-dig").name);
    const setup = new SetupPage(app);

    await app.open();
    await setup.fetchCatalogue();
    await setup.skipDiscogs();
    await setup.pickStyle("Drum n Bass");
    await setup.setYear("from", 1998);
    await setup.setYear("to", 2002);
    await setup.openLoadYears();
    await setup.setYear("from", 1990, { load: true });
    await setup.setYear("to", 2010, { load: true });
    await setup.setVinylOnly(false);
    await setup.fillCrate();

    const config = await app.api.get<Config>("/api/settings");
    expect(config.universe).toMatchObject({ styles: ["Drum n Bass"], loadYears: [1990, 2010] });
    expect(config.filters).toMatchObject({
      styles: null,
      yearFrom: 1998,
      yearTo: 2002,
      formats: [],
    });
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.find((job) => job.type === "dump_load")?.status).toBe("running");
  },
);

test.describe("a library with a finished load", () => {
  test.use({ diggaOptions: { template: "small" } });

  test(
    "SETUP-30 a library with a finished load never shows the setup, and #/setup goes to Triage",
    { tag: ["@SETUP-30", "@P1"] },
    async ({ app }) => {
      const setup = new SetupPage(app);
      const header = new HeaderPage(app);

      await app.open();
      // The setup opens only for a library whose stats say no load has finished; they have come.
      await expect(header.root.getByText(/^\d+ to go$/)).toBeVisible();
      expect(await app.page.evaluate(() => location.hash)).toBe("#/triage");
      expect(app.apiRequests()).not.toContain("GET /api/setup");

      await app.open("#/setup");
      await expect(header.link("triage")).toHaveAttribute("aria-current", "page");
      await expect(app.page).toHaveURL(/#\/triage$/);
      await expect(app.page).toHaveTitle("Triage – Digga");
      await expect(setup.heading("catalogue")).toBeHidden();
    },
  );
});

/** Step 1's line about the catalogue it fetches. */
function catalogueLine(setup: SetupPage) {
  return setup.root.getByText(/^Discogs publishes every release in one file a month\./);
}

/** The releases dumps the fake data.discogs.com has been asked to send, by file name. */
function dumpDownloads(fakes: FakeServices): string[] {
  return fakes.log
    .filter((request) => request.service === "dumps" && request.query.download?.endsWith(".xml.gz"))
    .map((request) => path.basename(request.query.download!));
}

/** A style's checkbox, named by its label: the style and its release count. */
function styleWithCount(style: string): RegExp {
  return new RegExp(`^${style} [\\d,]+$`);
}
