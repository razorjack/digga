import { STATUS_COPY } from "../../../src/client/keymap.ts";
import { MARK_COPY } from "../../../src/client/twelves/model.ts";
import type { BackupsResponse, DecisionsExport } from "../../../src/shared/api.ts";
import { INTERRUPTED_JOB_ERROR, type Job } from "../../../src/shared/types.ts";
import {
  DJ,
  FIRST_RECORD,
  releaseById,
  SECOND_RECORD,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { isRequest, TriagePage, verdictKey, waitForResponses } from "../pages/triage.ts";
import { judgeKey, TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

const COLLECTION_PAGE = "GET /users/:user/collection/folders/0/releases";

/** A snooze with a note, and a keep mark on one of the record's tracks. */
interface KeptDecisions {
  key: string;
  releaseId: number;
  title: string;
  note: string;
  position: string;
  trackTitle: string;
}

test(
  "PER-01 a live snooze with a note and a keep mark survive a reload and a relaunch",
  { tag: ["@PER-01", "@P0"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const key = await triage.currentKey();
    const release = releaseById(Number(await triage.record.getAttribute("data-release-id")))!;
    const track = release.tracks[0]!;
    const kept: KeptDecisions = {
      key,
      releaseId: release.id,
      title: release.title,
      note: "hear it again at the weekend",
      position: track.position,
      trackTitle: track.title,
    };

    await triage.startListening();
    await triage.markTrack("keep");
    await expect(triage.trackMark(track.position, "keep")).toBeVisible();
    await triage.writeNote(kept.note);
    await triage.judge("snoozed");

    await app.page.reload();
    await expectKept(app, kept);

    await app.relaunch();
    await app.open();
    await expectKept(app, kept);
  },
);

test(
  "PER-02 digga backup writes today's decisions, which digga restore brings into a fresh library",
  { tag: ["@PER-02", "@P2"] },
  async ({ app, newLibrary }) => {
    const twelves = new TwelvesPage(app);
    const [kept] = FIRST_RECORD.tracks;
    const note = "hear it at the weekend";
    await app.given.verdicts(
      datedVerdicts([
        { release: FIRST_RECORD, status: "snoozed" },
        { release: SECOND_RECORD, status: "maybe" },
      ]),
    );
    await app.given.trackMark({
      releaseId: FIRST_RECORD.id,
      position: kept!.position,
      mark: "keep",
    });
    await twelves.open();
    expect(await twelves.selectedKey()).toBe(triageKeyOf(FIRST_RECORD));
    await twelves.writeNote(note);
    await twelves.move("j");
    await twelves.rejudge("snoozed");
    // The server's start copied the database; digga backup must not write the copy beside it.
    await expect.poll(async () => (await backups(app)).backups).toHaveLength(1);

    const backup = await app.cli(["backup"]);
    expect(backup.code, backup.stderr).toBe(0);
    const written = /^backup: (\S+decisions-(\d{4}-\d{2}-\d{2})\.json\.gz) /m.exec(backup.stdout);
    expect(written, backup.stdout).not.toBeNull();
    const [, file, day] = written!;
    // The server lists the day's backup, the one `digga backup` wrote.
    expect((await backups(app)).decisions.backups).toEqual([expect.objectContaining({ day })]);

    const fresh = await newLibrary("small");
    const restore = await app.cli(["restore", file!], { library: fresh });
    expect(restore.code, restore.stderr).toBe(0);
    expect(restore.stdout).toMatch(/verdicts: +2 restored/);
    await app.relaunch({ library: fresh });
    await twelves.open();

    await twelves.showShelf("snoozed");
    await expect(twelves.records).toHaveCount(2);
    await expect(twelves.record(triageKeyOf(FIRST_RECORD))).toContainText(note);
    await expect(twelves.record(triageKeyOf(SECOND_RECORD))).toBeVisible();
    await twelves.showShelf("tracks");
    await expect(twelves.track(FIRST_RECORD.id, kept!.position)).toContainText(MARK_COPY.keep);
  },
);

test(
  "PER-12 digga restore of the database copy digga backup wrote brings the library into a fresh one",
  { tag: ["@PER-12", "@P2"] },
  async ({ app, newLibrary }) => {
    const twelves = new TwelvesPage(app);
    const [kept] = FIRST_RECORD.tracks;
    const note = "the dub on the B side";
    await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));
    await app.given.note(FIRST_RECORD.id, note);
    await app.given.trackMark({
      releaseId: FIRST_RECORD.id,
      position: kept!.position,
      mark: "keep",
    });
    // The server's start copied the database; digga backup must not write the copy beside it.
    await expect.poll(async () => (await backups(app)).backups).toHaveLength(1);

    const backup = await app.cli(["backup"]);
    expect(backup.code, backup.stderr).toBe(0);
    const copy = /^backup: (\S+digga-\d{4}-\d{2}-\d{2}\.sqlite) /m.exec(backup.stdout)?.[1];
    expect(copy, backup.stdout).toBeDefined();

    const fresh = await newLibrary("small");
    const restore = await app.cli(["restore", copy!], { library: fresh });
    expect(restore.code, restore.stderr).toBe(0);
    // The fresh library's own database is kept, apart from the daily copies.
    expect(restore.stdout).toMatch(
      /^copied the database first: \S+before-restore-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/m,
    );
    expect(restore.stdout).toMatch(
      /^restored \S+digga-\d{4}-\d{2}-\d{2}\.sqlite, schema version \d+$/m,
    );
    await app.relaunch({ library: fresh });
    await twelves.open();

    await twelves.showShelf("snoozed");
    await expect(twelves.records).toHaveCount(1);
    await expect(twelves.record(triageKeyOf(FIRST_RECORD))).toContainText(note);
    await twelves.showShelf("tracks");
    await expect(twelves.track(FIRST_RECORD.id, kept!.position)).toContainText(MARK_COPY.keep);
  },
);

test(
  "PER-11 while the server runs, a command that changes the library is refused, stats and backup run beside it, and a crash's lock does not keep the next start out",
  { tag: ["@PER-11", "@P2"] },
  async ({ app }) => {
    await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));
    // The server's start copied the database; digga backup must not write the copy beside it.
    await expect.poll(async () => (await backups(app)).backups).toHaveLength(1);

    const stats = await app.cli(["stats"]);
    expect(stats.code, stats.stderr).toBe(0);
    expect(stats.stdout).toMatch(/^verdicts: .*snoozed=1/m);
    const backup = await app.cli(["backup"]);
    expect(backup.code, backup.stderr).toBe(0);
    const file = /^backup: (\S+decisions-\d{4}-\d{2}-\d{2}\.json\.gz) /m.exec(backup.stdout)?.[1];
    expect(file, backup.stdout).toBeDefined();

    const holder = await refusedRestore(app, file!);
    await app.relaunch({ crash: true });
    // The crashed server's lock is left behind; the new server took it over.
    const nextHolder = await refusedRestore(app, file!);
    expect(nextHolder).not.toBe(holder);
    expect(await exportedStatus(app, triageKeyOf(FIRST_RECORD))).toBe("snoozed");
  },
);

/** Runs `digga restore`, which the server's lock refuses; returns the process the lock names. */
async function refusedRestore(app: DiggaApp, file: string): Promise<string> {
  const restore = await app.cli(["restore", file]);
  expect(restore.code).toBe(1);
  const refusal =
    /^digga: The library is in use by the Digga server \(process (\d+), since \S+\)\. Stop it first\.$/m;
  const holder = refusal.exec(restore.stderr)?.[1];
  expect(holder, restore.stderr).toBeDefined();
  return holder!;
}

test.describe("with an account to import", () => {
  test.use({
    diggaOptions: { config: { discogs: { username: DJ.username } }, savedToken: "e2e-token-dj" },
  });

  test(
    "PER-03 a crash during an import leaves the job failed as interrupted",
    { tag: ["@PER-03", "@P2"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const page = fakes.hold(COLLECTION_PAGE);
      const job = await startHeldImport(settings, page);

      await app.relaunch({ crash: true });
      await settings.open("discogs");

      await settings.waitForJob(job, "failed");
      await expect(settings.job(job)).toContainText(`: ${INTERRUPTED_JOB_ERROR}`);
      expect(await app.api.get<Job>(`/api/jobs/${job}`)).toMatchObject({
        status: "failed",
        error: INTERRUPTED_JOB_ERROR,
      });
    },
  );

  test(
    "PER-03 a graceful relaunch during an import cancels the job once its page in flight has returned",
    { tag: ["@PER-03", "@P2"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const page = fakes.hold(COLLECTION_PAGE);
      const job = await startHeldImport(settings, page);
      const stopping = app.servers.at(-1)!;

      let relaunched = false;
      const relaunching = app.relaunch().then(() => {
        relaunched = true;
      });
      // The stop aborts the job, then waits for it: a Discogs request takes no abort signal.
      await expect
        .poll(() => stopping.stdout)
        .toContain("stopping: cancelled 1 running job(s), waiting for them");
      expect(relaunched).toBe(false);
      page.release();
      await relaunching;
      await settings.open("discogs");

      await settings.waitForJob(job, "cancelled");
      expect((await app.api.get<Job>(`/api/jobs/${job}`)).status).toBe("cancelled");
      expect(fakes.requests(COLLECTION_PAGE)).toHaveLength(1);
      expect(stopping.stdout).toMatch(/waiting for them\n(.*\n)*.*job \S+ cancelled\n/);
    },
  );
});

test(
  "PER-05 after restartServer() the open page keeps its session without a reload, and the next verdict is saved",
  { tag: ["@PER-05", "@P1", "@web"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    await app.open();
    const first = await triage.currentKey();
    // The header reads the stats 0.5 s after a verdict, the last request the verdict causes.
    const refreshed = app.page.waitForResponse((response) =>
      isRequest(response, "GET", "/api/stats"),
    );
    await triage.judge("rejected");
    await (await refreshed).finished();
    await expect(header.root).toContainText("1 dug");
    const second = await triage.currentKey();
    const origin = app.origin;

    await app.restartServer();
    expect(app.servers).toHaveLength(2);
    expect(app.origin).toBe(origin);

    // No reload: the record, the slip and the session's count are as the old server left them.
    expect(await triage.currentKey()).toBe(second);
    await expect(triage.lastAction).toContainText(STATUS_COPY.rejected);
    await triage.judge("snoozed");
    await expect(header.root).toContainText("2 dug");
    await expect(header.root).toContainText("+2 this session");
    expect(await exportedStatus(app, first)).toBe("rejected");
    expect(await exportedStatus(app, second)).toBe("snoozed");
  },
);

test.describe("with a Discogs account and the clock", () => {
  test.use({
    diggaOptions: { template: "small-account", savedToken: "e2e-token-dj", clock: true },
  });

  test(
    "PER-04 a verdict the server never got comes back, pushes nothing, and saves on the next try",
    { tag: ["@PER-04", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      app.expectProblems({
        aborted: [/^POST \/api\/verdicts$/],
        consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
      });
      await app.abortRequests({ method: "POST", path: "/api/verdicts" });
      await app.open();
      const key = await triage.currentKey();
      const releaseId = await triage.record.getAttribute("data-release-id");
      // Saving the token asked Discogs whose it is, before the page opened.
      const fakeRequestsBefore = fakes.log.length;

      await app.page.keyboard.press(verdictKey("accepted"));
      await expect(triage.messages).toHaveText(/^The verdict was not saved: \S/);
      await expect(triage.record).toHaveAttribute("data-triage-key", key);
      await expect(triage.lastAction).not.toHaveAttribute("aria-busy", "true");

      expect(app.apiRequests().filter((request) => request.includes("/api/discogs/"))).toEqual([]);
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([]);
      expect(await exportedStatus(app, key)).toBeUndefined();

      await triage.judge("accepted");
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      expect(await exportedStatus(app, key)).toBe("accepted");
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: "dj", id: releaseId } }),
      ]);
    },
  );
});

test.describe("two pages of the app", () => {
  /** The server's refusal of a write whose expected verdict another page has replaced. */
  const CHANGED =
    "The record's verdict changed since this page read it, in another tab or by a load; reload to see it";

  test(
    "PER-10 an undo in one page is refused once another page has re-judged the record",
    { tag: ["@PER-10", "@P2"] },
    async ({ app }) => {
      app.expectProblems({ apiErrors: [/^DELETE \/api\/verdicts\/\S+ answered 409$/] });
      const triage = new TriagePage(app);
      await app.open();
      const key = await triage.currentKey();
      await triage.judge("snoozed");

      const other = await app.openPage();
      const otherTwelves = new TwelvesPage(other);
      await otherTwelves.open();
      await otherTwelves.showShelf("snoozed");
      expect(await otherTwelves.selectedKey()).toBe(key);
      await otherTwelves.rejudge("rejected");

      const refused = app.page.waitForResponse((response) =>
        isRequest(response, "DELETE", `/api/verdicts/${key}`),
      );
      await app.page.keyboard.press("z");
      expect((await refused).status()).toBe(409);
      await expect(triage.messages).toHaveText(`Undo failed: ${CHANGED}`);
      await expect(triage.lastAction).not.toHaveAttribute("aria-busy", "true");
      await expect(triage.record).not.toHaveAttribute("data-triage-key", key);
      expect(await exportedStatus(app, key)).toBe("rejected");
    },
  );

  test(
    "PER-10 a Twelves change in one page is refused once another page has re-judged the record",
    { tag: ["@PER-10", "@P2"] },
    async ({ app }) => {
      app.expectProblems({ apiErrors: [/^POST \/api\/verdicts answered 409$/] });
      const key = triageKeyOf(FIRST_RECORD);
      await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));
      const twelves = new TwelvesPage(app);
      await twelves.open();
      await twelves.showShelf("snoozed");
      expect(await twelves.selectedKey()).toBe(key);

      const other = await app.openPage();
      const otherTwelves = new TwelvesPage(other);
      await otherTwelves.open();
      await otherTwelves.showShelf("snoozed");
      await otherTwelves.rejudge("rejected");

      // This page still shows the snooze, which its change expects the record to have.
      await expect(twelves.selected).toHaveAttribute("data-triage-key", key);
      const { first: saved, next: reloaded } = waitForResponses(
        app.page,
        (response) => isRequest(response, "POST", "/api/verdicts"),
        (response) => isRequest(response, "GET", "/api/twelves"),
      );
      await app.page.keyboard.press(judgeKey("no_audio"));
      expect((await saved).status()).toBe(409);
      await (await reloaded).finished();
      await expect(twelves.messages).toHaveText(`Not saved: ${CHANGED}`);
      await expect(twelves.record(key)).toHaveCount(0);
      expect(await exportedStatus(app, key)).toBe("rejected");
    },
  );
});

/** Triage no longer offers the record; Twelves and the export show the snooze and the mark. */
async function expectKept(app: DiggaApp, kept: KeptDecisions): Promise<void> {
  const twelves = new TwelvesPage(app);
  expect(await new TriagePage(app).currentKey()).not.toBe(kept.key);

  await new HeaderPage(app).goTo("twelves");
  await twelves.showShelf("snoozed");
  await expect(twelves.row("snoozed", kept.title)).toContainText(kept.note);
  await twelves.showShelf("tracks");
  await expect(twelves.row("tracks", kept.trackTitle)).toContainText(MARK_COPY.keep);

  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  expect(exported.verdicts).toContainEqual(
    expect.objectContaining({ key: kept.key, status: "snoozed", notes: kept.note }),
  );
  expect(exported.trackMarks).toContainEqual(
    expect.objectContaining({ releaseId: kept.releaseId, position: kept.position, mark: "keep" }),
  );
}

async function exportedStatus(app: DiggaApp, key: string): Promise<string | undefined> {
  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  return exported.verdicts.find((verdict) => verdict.key === key)?.status;
}

function backups(app: DiggaApp): Promise<BackupsResponse> {
  return app.api.get<BackupsResponse>("/api/backups");
}

/** Starts the collection import from Settings; returns its id once it runs, its page held. */
async function startHeldImport(
  settings: SettingsPage,
  page: { received: Promise<void> },
): Promise<string> {
  await settings.open("discogs");
  const job = await settings.startJob(settings.imports.getByRole("button", { name: "Collection" }));
  await page.received;
  await settings.waitForJob(job, "running");
  return job;
}
