import {
  estimateCatalogue,
  loadYearsFor,
  middleSpan,
  roundEstimate,
  yearHistogram,
} from "../../../src/client/setup/model.ts";
import type {
  DiscogsAccountResponse,
  JobsResponse,
  SetupResponse,
} from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatCount } from "../../../src/shared/display.ts";
import type { StyleCensus } from "../../../src/shared/style-census.ts";
import type { Job } from "../../../src/shared/types.ts";
import { PUSH_RETRY_DELAYS_MS } from "../../../src/shared/wantlist.ts";
import { DJ, releaseById } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { type Picks, SetupPage, type SetupStep } from "../pages/setup.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { LiveRegionWatch } from "../support/live-regions.ts";
import { expect, test } from "../support/test.ts";

/** A new user's library, and data.discogs.com offering the bulk dump. */
const FIRST_RUN = { template: "empty", listedDump: "bulk" } as const;

test.use({ diggaOptions: FIRST_RUN });

const DJ_TOKEN = `e2e-token-${DJ.username}`;

test(
  "SETUP-08 a token Discogs accepts names the account, its sizes and its currency",
  { tag: ["@SETUP-08", "@P1"] },
  async ({ app }) => {
    test.slow();
    const regions = await LiveRegionWatch.install(app.page);
    const setup = await openDiscogsStep(app);

    await setup.connect(DJ_TOKEN);
    await expect(setup.account).toHaveText(
      `Connected as ${DJ.username}: ${DJ.collection.length} in your collection, ` +
        `${DJ.wantlist.length} wants.`,
    );
    expect(await regions.insertedWithText()).not.toContainEqual(
      expect.stringContaining("Connected as"),
    );
    expect((await app.api.get<Config>("/api/settings")).discogs.username).toBe(DJ.username);
    await expect(setup.currency).toHaveValue(DJ.currency);

    await setup.seedsCheckbox.uncheck();
    await setup.continueFromDiscogs();
    expect((await app.api.get<Config>("/api/settings")).discogs.currency).toBe(DJ.currency);
    const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
    expect(jobs.map((job) => job.type)).toEqual(["dump_download"]);
  },
);

test(
  "SETUP-09 a token Discogs refuses is not kept, and the field says why until it is edited",
  { tag: ["@SETUP-09", "@P1"] },
  async ({ app }) => {
    test.slow();
    app.expectProblems({ apiErrors: [/^PUT \/api\/discogs\/token answered 400$/] });
    const regions = await LiveRegionWatch.install(app.page);
    const refusal = "Discogs refused this token; copy it again from discogs.com";
    const setup = await openDiscogsStep(app);

    await setup.connectRefused("e2e-token-refused");
    await expect(setup.alert(refusal)).toBeVisible();
    expect(await regions.insertedWithText()).not.toContainEqual(expect.stringContaining(refusal));
    const account = await app.api.get<DiscogsAccountResponse>("/api/discogs/account");
    expect(account).toMatchObject({ username: "", hasToken: false });
    await expect(setup.account).toBeHidden();

    await expect(setup.tokenField).toHaveAttribute("aria-invalid", "true");
    await expect(setup.tokenField).toHaveAccessibleDescription(
      new RegExp(`^The token stays on this computer\\..* ${refusal}$`),
    );
    await setup.tokenField.press("Backspace");
    await expect(setup.tokenField).not.toHaveAttribute("aria-invalid");
    await expect(setup.tokenField).toHaveAccessibleDescription(
      /^The token stays.*Open discogs\.com$/,
    );
  },
);

test(
  "SETUP-13 Continue starts the collection and wantlist imports and moves on while they run",
  { tag: ["@SETUP-13", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const wantlist = fakes.hold("GET /users/:user/wants");
    const setup = await openDiscogsStep(app);
    await setup.connect(DJ_TOKEN);

    await setup.continueFromDiscogs(["collection", "wantlist"]);
    await wantlist.received;
    expect(await importStatuses(app)).toMatchObject({ import_wantlist: "running" });

    wantlist.release();
    await expect
      .poll(() => importStatuses(app))
      .toEqual({ import_collection: "done", import_wantlist: "done" });
    const pages = [
      ...fakes.requests("GET /users/:user/collection/folders/0/releases"),
      ...fakes.requests("GET /users/:user/wants"),
    ];
    expect(pages.map((page) => [page.path, page.authenticatedAs])).toEqual([
      [`/users/${DJ.username}/collection/folders/0/releases`, DJ.username],
      [`/users/${DJ.username}/wants`, DJ.username],
    ]);
  },
);

test(
  "SETUP-20 the load waits for imports slower than its start, and Start without it starts it at once",
  { tag: ["@SETUP-20", "@P2"] },
  async ({ app, fakes }) => {
    test.slow();
    const wantlist = fakes.hold("GET /users/:user/wants");
    const setup = await openDiscogsStep(app);
    await setup.connect(DJ_TOKEN);
    await setup.continueFromDiscogs(["collection", "wantlist"]);
    await setup.pickStyle("Drum n Bass");

    await setup.fillCrateBehindImports();
    await expect(setup.waitingForImports).toHaveText(
      "Reading your collection and wantlist first, so the load also keeps other records on your labels.",
    );
    await wantlist.received;
    expect(await jobStatuses(app, "dump_load")).toEqual([]);

    await setup.startWithoutImports();
    expect(await importStatuses(app)).toMatchObject({ import_wantlist: "running" });
    expect(await jobStatuses(app, "dump_load")).toEqual([
      expect.stringMatching(/^(running|done)$/),
    ]);

    wantlist.release();
    await expect
      .poll(() => importStatuses(app))
      .toEqual({ import_collection: "done", import_wantlist: "done" });
    await setup.waitForCatalogue();
  },
);

test(
  "SETUP-14 after the imports, step 3 picks the account's styles, with the years and estimate for them",
  { tag: ["@SETUP-14", "@P1"] },
  async ({ app }) => {
    test.slow();
    // The census has no Techstep, the fixture's second style, so it is not suggested.
    const picks = ["Drum n Bass"];
    const setup = await openDiscogsStep(app);
    await setup.connect(DJ_TOKEN);
    await setup.continueFromDiscogs(["collection", "wantlist"]);

    await setup.keepSuggestedStyles(picks);
    await expect(setup.suggestion).toHaveText(
      "Your Discogs records are mostly Drum n Bass, so it is picked. Change them as you like.",
    );
    await expect(setup.pickedStyles.getByRole("listitem")).toHaveCount(picks.length);

    // Three imported releases are too few to say which years, so the census's middle 80% decides.
    const { seeds } = await app.api.get<SetupResponse>("/api/setup");
    expect(seeds.releases).toBe(DJ.collection.length + DJ.wantlist.length);
    const census = await app.api.get<StyleCensus>("/api/styles");
    const span = middleSpan(yearHistogram(census, picks))!;
    await expect(setup.yearField("from")).toHaveValue(String(span[0]));
    await expect(setup.yearField("to")).toHaveValue(String(span[1]));
    const estimate = estimateCatalogue(census, picks, {
      span,
      vinylOnly: true,
      loadYears: loadYearsFor(span),
    });
    await expect(setup.estimate).toContainText(
      `About ${formatCount(roundEstimate(estimate.releases))} releases`,
    );
  },
);

test(
  "SETUP-28 a new page resumes at the first step not done, with the account and the picks filled in",
  { tag: ["@SETUP-28", "@P1"] },
  async ({ app, fakes }) => {
    test.slow();
    const point = fakes.dumps.checkpoint("100-to-dig");
    fakes.dumps.holdAt(point.name);
    const wantlist = fakes.hold("GET /users/:user/wants");
    const setup = new SetupPage(app);
    const picks: Picks = {
      styles: ["Drum n Bass", "Jungle"],
      span: [1997, 2003],
      vinylOnly: false,
    };

    // Nothing fetched: step 1, whatever the address asks.
    await openNewPage(setup, "#/setup/sound", "catalogue");
    await setup.fetchCatalogue();
    // The catalogue comes: step 2, or step 3 when the address asks.
    await openNewPage(setup, "#/setup", "discogs");
    await openNewPage(setup, "#/setup/sound", "sound");

    // By username: a token's account check would wait behind the held wantlist page, since the
    // server sends Discogs one request at a time, and hold up every new page.
    await openNewPage(setup, "#/setup/discogs", "discogs");
    await setup.useUsername(DJ.username);
    await openNewPage(setup, "#/setup/discogs", "discogs");
    await expect(setup.account).toContainText(`Connected as ${DJ.username}`);
    await setup.continueFromDiscogs(["collection", "wantlist"]);
    await wantlist.received;
    await setup.makePicks(picks);
    await setup.fillCrateBehindImports();

    // The load waits for the wantlist, so no load exists yet: step 3, with the picks confirmed.
    await openNewPage(setup, "#/setup", "sound");
    await setup.expectPicks(picks);

    await setup.fillCrateBehindImports();
    wantlist.release();
    await setup.waitForRecordsToDig(point.recordsToDig);
    // Once a load exists, its screen.
    await openNewPage(setup, "#/setup/sound", "crate");
  },
);

/**
 * The setup in a new page at the address, as after closing the tab: the hash changes in the
 * page, and the reload opens it afresh, so the setup resumes from what the server has.
 */
async function openNewPage(setup: SetupPage, address: string, step: SetupStep): Promise<void> {
  await setup.app.open(address);
  await setup.reload(step);
}

/** Step 2, with the download started from step 1. */
test.describe("with the clock", () => {
  test.use({ diggaOptions: { ...FIRST_RUN, clock: true } });

  test(
    "SETUP-10 with a username and no token, a want stays in Digga: its push fails once, and Twelves says it is not on the wantlist",
    { tag: ["@SETUP-10", "@P2"] },
    async ({ app, fakes }) => {
      test.slow();
      const point = fakes.dumps.checkpoint("600-to-dig");
      fakes.dumps.holdAt(point.name);
      app.expectProblems({ apiErrors: [/^POST \/api\/discogs\/wantlist\/\d+ answered 400$/] });
      const triage = new TriagePage(app);
      const twelves = new TwelvesPage(app);
      const setup = await openDiscogsStep(app);

      await setup.useUsername(DJ.username);
      expect(fakes.requests("GET /users/:user")).toEqual([
        expect.objectContaining({ params: { user: DJ.username }, authenticatedAs: null }),
      ]);
      await setup.continueFromDiscogs(["collection", "wantlist"]);
      await setup.keepSuggestedStyles(["Drum n Bass"]);
      await setup.fillCrate();
      await setup.waitForRecordsToDig(point.recordsToDig);
      await setup.startDigging();

      const releaseId = Number(await triage.record.getAttribute("data-release-id"));
      const want = releaseById(releaseId)!;
      const key = await triage.currentKey();
      const push = await triage.judgeAndPush("accepted");
      expect(push.status()).toBe(400);
      await expect(triage.lastAction).toContainText("Saved, but not on the Discogs wantlist.");
      await expect(triage.messages).toHaveText(
        `${want.artists[0]} – ${want.title} is not on the Discogs wantlist: Set your Discogs token in Settings first. A in Twelves tries again.`,
      );
      // A refusal will not pass later, so nothing is tried again after the first delay.
      await app.clock.runFor(PUSH_RETRY_DELAYS_MS[0]! + 1000);
      expect(
        app.apiRequests().filter((request) => request.startsWith("POST /api/discogs/wantlist/")),
      ).toEqual([`POST /api/discogs/wantlist/${releaseId}`]);
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([]);

      await new HeaderPage(app).goTo("twelves");
      await twelves.showShelf("accepted");
      await expect(
        twelves.record(key).getByText("not on your Discogs wantlist", { exact: true }),
      ).toBeVisible();
      await expect(twelves.wantlistHandoff).toContainText(
        "1 record is not on your Discogs wantlist.",
      );
    },
  );
});

async function openDiscogsStep(app: DiggaApp): Promise<SetupPage> {
  const setup = new SetupPage(app);
  await app.open();
  await setup.fetchCatalogue();
  return setup;
}

/** The statuses of the jobs of one type, newest first. */
async function jobStatuses(app: DiggaApp, type: Job["type"]): Promise<Job["status"][]> {
  const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
  return jobs.filter((job) => job.type === type).map((job) => job.status);
}

/** The status of each import job, by type. */
async function importStatuses(app: DiggaApp): Promise<Partial<Record<Job["type"], Job["status"]>>> {
  const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
  const imports = jobs.filter((job) => job.type.startsWith("import_"));
  return Object.fromEntries(imports.map((job) => [job.type, job.status]));
}
