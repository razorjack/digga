import fs from "node:fs";
import type { Locator } from "@playwright/test";
import type {
  BackupsResponse,
  DecisionsExport,
  DumpsResponse,
  JobsResponse,
  QueueResponse,
  ReleaseDetail,
  Stats,
} from "../../../src/shared/api.ts";
import { type Config, validateConfig } from "../../../src/shared/config.ts";
import { formatBytes, formatCount, formatDay } from "../../../src/shared/display.ts";
import { startSeconds } from "../../../src/shared/playlist.ts";
import type { DumpLoadProgress, Job } from "../../../src/shared/types.ts";
import {
  ECHO_CHAMBER,
  FIRST_RECORD,
  IN_COLLECTION,
  PULSAR_REMIXES,
  PULSAR_REMIXES_IN_SEPTEMBER,
  SECOND_RECORD,
  SEPTEMBER_ADDITIONS,
  TRACK_RUN,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { smallDump } from "../fixtures/dump.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import type { FakeServices } from "../../../tools/dev/fake-services.ts";
import { expect, test } from "../support/test.ts";

// Settings without Discogs: the form, the filter preview, the player, the dumps folder and the
// exports (docs/e2e/scenarios/settings.md).

test(
  "SET-01 the form shows the saved config; a change is unsaved until Save or Cmd+S, Revert restores, a reload keeps it",
  { tag: ["@SET-01", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    const { queue, player, filters } = await app.api.get<Config>("/api/settings");
    await settings.open();
    await expect(settings.batch).toHaveValue(String(queue.limit));
    await expect(settings.seekStep).toHaveValue(String(player.seekStepSeconds));
    await expect(settings.fromYear).toHaveValue(String(filters.yearFrom));
    await expect(settings.root.getByText("All saved.", { exact: true })).toBeVisible();
    await expect(settings.revertButton).toBeDisabled();
    await expect(settings.saveButton).toBeDisabled();

    await settings.batch.fill("50");
    await expect(settings.root.getByText("Unsaved changes.", { exact: true })).toBeVisible();
    await settings.revertButton.click();
    await expect(settings.batch).toHaveValue(String(queue.limit));
    await expect(settings.root.getByText("All saved.", { exact: true })).toBeVisible();

    await settings.batch.fill("50");
    await settings.save();
    expect((await app.api.get<Config>("/api/settings")).queue.limit).toBe(50);
    await settings.seekStep.fill("15");
    await expect(settings.seekStep).toBeFocused();
    await settings.saveWithShortcut();
    expect((await app.api.get<Config>("/api/settings")).player.seekStepSeconds).toBe(15);

    await app.page.reload();
    await expect(settings.saveButton).toBeVisible();
    await expect(settings.batch).toHaveValue("50");
    await expect(settings.seekStep).toHaveValue("15");
    await expect(settings.root.getByText("All saved.", { exact: true })).toBeVisible();
  },
);

test(
  "SET-02 the filter preview counts what a change would match before it is saved",
  { tag: ["@SET-02", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    // A verdict on a record from 2001 makes "still to dig" one less than "match".
    const judged = TRACK_RUN;
    await app.given.verdict({
      key: triageKeyOf(judged),
      status: "rejected",
      releaseId: judged.id,
    });
    await settings.open();
    await expect(settings.preview).toHaveText("These filters match 18 records, 17 still to dig.");

    await settings.fromYear.fill("2000");

    await expect(settings.preview).toHaveText("These filters match 14 records, 13 still to dig.");
    await expect(settings.root.getByText("Unsaved changes.", { exact: true })).toBeVisible();
    await expect(settings.library).toContainText(
      "18 match your saved filters; 17 are still to dig.",
    );
    expect((await app.api.get<Config>("/api/settings")).filters.yearFrom).toBe(1998);
    expect(app.apiRequests()).not.toContain("PUT /api/settings");
  },
);

test(
  "SET-03 an invalid batch or seek step marks the field, attaches the problem to it and disables Save",
  { tag: ["@SET-03", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    const saved = await app.api.get<Config>("/api/settings");
    await settings.open();

    await settings.batch.fill("0");
    const batchProblem = problemOf({ ...saved, queue: { ...saved.queue, limit: 0 } });
    await expectProblem(settings, settings.batch, batchProblem);
    await expect(settings.batch).toHaveAccessibleDescription(
      `Releases fetched per queue request. ${batchProblem.message}`,
    );

    await settings.batch.fill("50");
    await expectNoProblem(settings.batch);
    await expect(settings.batch).toHaveAccessibleDescription("Releases fetched per queue request.");
    await expect(settings.saveButton).toBeEnabled();

    await settings.seekStep.fill("0");
    const seekProblem = problemOf({ ...saved, player: { ...saved.player, seekStepSeconds: 0 } });
    await expectProblem(settings, settings.seekStep, seekProblem);
    await expect(settings.seekStep).toHaveAccessibleDescription(
      new RegExp(`^Seconds per .+\\. ${escapeRegExp(seekProblem.message)}$`),
    );
  },
);

test(
  "SET-04 hidden labels: one per line, a saved label leaves the queue, and X's labels show here with their ids",
  { tag: ["@SET-04", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    const first = FIRST_RECORD.label.name;
    const third = "Cold Storage";
    await settings.open();
    await expect(settings.hiddenLabels).toHaveValue("");

    await settings.change(settings.hiddenLabels, `  ${first}\n\n${third}  \n`);
    await settings.save();

    await expect(settings.hiddenLabels).toHaveValue(`${first}\n${third}`);
    expect((await app.api.get<Config>("/api/settings")).filters.excludeLabels).toEqual([
      { id: null, name: first },
      { id: null, name: third },
    ]);
    await header.goTo("triage");
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));

    await triage.hideLabel();
    await header.goTo("settings");

    await expect(settings.hiddenLabels).toHaveValue(
      `${first}\n${third}\n${SECOND_RECORD.label.name}`,
    );
    await settings.change(settings.hiddenLabels, `${first}\n${SECOND_RECORD.label.name}`);
    await settings.save();

    expect((await app.api.get<Config>("/api/settings")).filters.excludeLabels).toEqual([
      { id: null, name: first },
      { id: SECOND_RECORD.label.id, name: SECOND_RECORD.label.name },
    ]);
  },
);

test.describe("with Neurofunk in the universe beside Drum n Bass", () => {
  test.use({ diggaOptions: { config: { universe: { styles: ["Drum n Bass", "Neurofunk"] } } } });

  test(
    "SET-05 the universe's styles are checkboxes, and one left checked narrows the queue to it",
    { tag: ["@SET-05", "@P2"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      await settings.open();
      await expect(settings.styleFilter("Drum n Bass")).toBeChecked();
      await expect(settings.styleFilter("Neurofunk")).toBeChecked();
      await expect(settings.preview).toHaveText(/^These filters match 18 records/);

      await settings.styleFilter("Drum n Bass").uncheck();
      // Of the small dump's records, only the second carries Neurofunk.
      await expect(settings.preview).toHaveText("These filters match 1 records, 1 still to dig.");
      await settings.save();

      expect((await app.api.get<Config>("/api/settings")).filters.styles).toEqual(["Neurofunk"]);
      await new HeaderPage(app).goTo("triage");
      await expect(triage.record).toHaveAttribute("data-triage-key", triageKeyOf(SECOND_RECORD));
      const queue = await app.api.get<QueueResponse>("/api/queue");
      expect(queue.items.map((item) => item.triageKey)).toEqual([triageKeyOf(SECOND_RECORD)]);
    },
  );
});

test.describe("on Cold Storage and Echo Chamber", () => {
  // The label sweep starts on Cold Storage's 2000 record, the year order on Echo Chamber's 1999 one.
  test.use({ diggaOptions: { labels: [IN_COLLECTION.label.name, ECHO_CHAMBER.name] } });

  test(
    "SET-06 a strategy changes Triage's first record, and the shuffled order stays over a reload",
    { tag: ["@SET-06", "@P2"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      await app.open();
      const sweepFirst = await triage.currentKey();
      await header.goTo("settings");

      await settings.strategy("year").check();
      const byYear = await queueAfter(app, () => settings.save());
      await header.goTo("triage");
      expect(await triage.currentKey()).toBe(byYear.items[0]!.triageKey);
      expect(byYear.items[0]!.triageKey).not.toBe(sweepFirst);

      await header.goTo("settings");
      await settings.strategy("random").check();
      let shuffled = await queueAfter(app, () => settings.save());
      expect(shuffled.seed).not.toBeNull();
      // The seed is the server's UTC day: a read across midnight starts the comparison again.
      let compared = false;
      for (let read = 0; read < 2 && !compared; read += 1) {
        const reloaded = await queueAfter(app, () => app.page.reload());
        if (reloaded.seed === shuffled.seed) {
          expect(keysOf(reloaded)).toEqual(keysOf(shuffled));
          compared = true;
        }
        shuffled = reloaded;
      }
      expect(compared, "two reads within one UTC day").toBe(true);
      await header.goTo("triage");
      expect(await triage.currentKey()).toBe(shuffled.items[0]!.triageKey);
    },
  );
});

test.describe("with the clock", () => {
  test.use({ diggaOptions: { clock: true } });

  test(
    "SET-07 the start-at slider and the seek step reach the player",
    { tag: ["@SET-07", "@P1"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      const video = FIRST_RECORD.videos[0]!;
      const startAt = startSeconds(video.seconds, 0.25)!;
      await settings.open();
      await expect(settings.startAt).toHaveAttribute("aria-valuetext", "50% into each track");

      await settings.startAt.focus();
      for (let step = 0; step < 5; step += 1) await app.page.keyboard.press("ArrowLeft");
      await expect(settings.startAt).toHaveAttribute("aria-valuetext", "25% into each track");
      await settings.seekStep.fill("20");
      await settings.save();
      await new HeaderPage(app).goTo("triage");

      await expect
        .poll(() => app.youtube.loads())
        .toContainEqual(
          expect.objectContaining({ kind: "cue", videoId: video.id, startSeconds: startAt }),
        );
      // The keys pressed in Settings gave the page activation, so the cued video reads paused
      // rather than waiting for Space. Paused, the video's time moves only through the keys.
      await app.clock.pause();
      await triage.resume();
      expect(await audibleTime(app)).toBe(startAt);
      await app.page.keyboard.press("ArrowRight");
      await expect.poll(() => audibleTime(app)).toBe(startAt + 20);
    },
  );
});

test.describe("with dumps in the folder", () => {
  test.use({
    diggaOptions: { dumpFiles: ["july", "august", "september"], listedDump: "september" },
  });

  test(
    "SET-16 the dumps folder lists each dump's size and use; Delete asks first; dump jobs disable the buttons",
    { tag: ["@SET-16", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const july = smallDump("july");
      const august = smallDump("august");
      const september = smallDump("september");
      await settings.open();
      await expect(settings.dumps.getByRole("listitem")).toHaveText([
        new RegExp(`^${september.name}`),
        new RegExp(`^${august.name}`),
        new RegExp(`^${july.name}`),
      ]);
      const size = formatBytes(september.data.length);
      await expect(settings.dump(september.name)).toContainText(`${size}, not loaded yet`);
      await expect(settings.dump(august.name)).toContainText(
        `${formatBytes(august.data.length)}, the library was loaded from it`,
      );
      await expect(settings.dump(july.name)).toContainText(
        `${formatBytes(july.data.length)}, nothing needs it: the ${formatDay(september.date)} dump is newer`,
      );

      const question = `confirm: Delete ${september.name} (${size})? Loading it again means downloading it again.`;
      expect(await settings.deleteDump(september.name, "dismiss")).toBe(question);
      await expect(settings.dump(september.name)).toBeVisible();
      expect(app.apiRequests().filter((request) => request.startsWith("DELETE "))).toEqual([]);
      expect(await settings.deleteDump(september.name, "accept")).toBe(question);
      await expect(
        settings.root.getByText(`Deleted ${september.name}; ${size} freed.`),
      ).toBeVisible();
      const listed = await app.api.get<DumpsResponse>("/api/dumps");
      expect(listed.files.map((file) => file.name)).toEqual([august.name, july.name]);

      fakes.dumps.holdAt("part-way");
      const download = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Download only" }),
      );
      await settings.waitForJob(download, "running");
      await expect
        .poll(() => fakes.dumps.sentBytes)
        .toBe(fakes.dumps.checkpoint("part-way").offset);
      for (const button of dumpButtons(settings, [august.name, july.name]))
        await expect(button).toBeDisabled();

      fakes.dumps.release();
      await settings.waitForJob(download, "done");
      await expect(settings.dump(september.name)).toContainText(`${size}, not loaded yet`);
      for (const button of dumpButtons(settings, [september.name, august.name, july.name]))
        await expect(button).toBeEnabled();
    },
  );
});

test.describe("with the September dump listed", () => {
  test.use({ diggaOptions: { listedDump: "september" } });

  test(
    "SET-17 Update from the newest dump downloads and loads in one job; the Library counts what it added and did not find",
    { tag: ["@SET-17", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const header = new HeaderPage(app);
      const september = smallDump("september");
      const jobsBefore = await jobIds(app);
      await settings.open();
      const update = await startHeldUpdate(settings, fakes);

      // The job Settings started reaches the header without a reload.
      await expect(header.loadIndicator).toHaveAccessibleName(/^loading\b/);
      fakes.dumps.release();
      await settings.waitForJob(update, "done");

      expect((await jobIds(app)).filter((id) => !jobsBefore.includes(id))).toEqual([update]);
      const job = await app.api.get<Job>(`/api/jobs/${update}`);
      expect(job.progress).toMatchObject({
        step: "load",
        added: SEPTEMBER_ADDITIONS.length,
        missing: 1,
      });
      await expect(settings.library).toContainText(`from the ${formatDay(september.date)} dump`);
      await expect(settings.library).toContainText(
        `added ${SEPTEMBER_ADDITIONS.length} releases. ${SEPTEMBER_ADDITIONS.length} records among them are still to dig`,
      );
      await expect(settings.library).toContainText(
        "It did not find 1 release loaded before, which stay in the library.",
      );
      await expect(settings.dump(september.name)).toContainText("the library was loaded from it");
      await expect(header.loadIndicator).toBeHidden();
    },
  );

  test(
    "SET-21 the update keeps a verdict on its record when the newer dump puts the release on a master",
    { tag: ["@SET-21", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const twelves = new TwelvesPage(app);
      await app.given.verdict({
        key: triageKeyOf(PULSAR_REMIXES),
        status: "snoozed",
        releaseId: PULSAR_REMIXES.id,
      });
      await app.given.note(PULSAR_REMIXES.id, "the remix");
      await settings.open();
      const update = await startHeldUpdate(settings, fakes);
      fakes.dumps.release();
      await settings.waitForJob(update, "done");

      await new HeaderPage(app).goTo("twelves");
      await twelves.showShelf("snoozed");
      await expect(twelves.row("snoozed", PULSAR_REMIXES.title)).toContainText("the remix");
      const detail = await app.api.get<ReleaseDetail>(`/api/releases/${PULSAR_REMIXES.id}`);
      expect(detail.verdict).toMatchObject({
        key: triageKeyOf(PULSAR_REMIXES_IN_SEPTEMBER),
        status: "snoozed",
      });
      expect(detail.note).toBe("the remix");
    },
  );
});

test.describe("with the September dump in the folder", () => {
  test.use({ diggaOptions: { dumpFiles: ["july", "september"] } });

  test(
    "SET-18 Load takes a file name from the datalist, with a limit and a dry run that records nothing",
    { tag: ["@SET-18", "@P2"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const september = smallDump("september");
      const statsBefore = await app.api.get<Stats>("/api/stats");
      await settings.open();
      expect(await settings.dumpFileOptions()).toEqual([september.name, smallDump("july").name]);

      await settings.dumpFile.fill(september.name);
      await settings.jobs.getByRole("spinbutton", { name: "Limit" }).fill("2");
      await settings.jobs.getByRole("checkbox", { name: "dry run" }).check();
      const sent = app.page.waitForRequest(
        (request) =>
          request.method() === "POST" && new URL(request.url()).pathname === "/api/jobs/dump-load",
      );
      const load = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Load", exact: true }),
      );
      expect((await sent).postDataJSON()).toEqual({
        file: september.name,
        limit: 2,
        dryRun: true,
      });
      await settings.waitForJob(load, "done");

      const job = await app.api.get<Job>(`/api/jobs/${load}`);
      expect(job.progress).toMatchObject({ matched: 2, added: null });
      await expect(settings.job(load)).toContainText(
        `scanned ${formatCount((job.progress as DumpLoadProgress).scanned)}, matched 2`,
      );
      // A dry run records no load: the library is still the August dump's.
      const stats = await app.api.get<Stats>("/api/stats");
      expect(stats.dump).toEqual(statsBefore.dump);
      expect(stats.remaining).toBe(statsBefore.remaining);
    },
  );
});

test(
  "SET-19 a relaunch with verdicts writes the day's decisions backup, which Settings shows",
  { tag: ["@SET-19", "@P2"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    // The first start checks before the verdict exists; its checkpoint is the check's last write.
    await expect.poll(async () => (await backups(app)).checkpoints.backups).toHaveLength(1);
    // An empty library gets no daily backup.
    expect((await backups(app)).decisions.backups).toEqual([]);
    await app.given.verdict({
      key: triageKeyOf(FIRST_RECORD),
      status: "snoozed",
      releaseId: FIRST_RECORD.id,
    });
    await settings.open();
    await expect(settings.exports).toContainText("Your decisions: no backup yet.");

    await app.relaunch();
    // The start writes the backup beside answering requests.
    await expect.poll(async () => (await backups(app)).decisions.backups).toHaveLength(1);
    const [backup] = (await backups(app)).decisions.backups;
    await settings.open();

    await expect(settings.exports).toContainText(
      `Your decisions: last backed up ${formatDay(`${backup!.day}T00:00:00`)} (${formatBytes(backup!.bytes)}).`,
    );
  },
);

test(
  "SET-20 the three exports download the saved verdicts and marks, without the sandbox's",
  { tag: ["@SET-20", "@P1"] },
  async ({ app }) => {
    const settings = new SettingsPage(app);
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    const [grail] = FIRST_RECORD.tracks;
    const saved = [
      { key: triageKeyOf(FIRST_RECORD), status: "candidate", releaseId: FIRST_RECORD.id },
      { key: triageKeyOf(SECOND_RECORD), status: "rejected", releaseId: SECOND_RECORD.id },
    ] as const;
    for (const verdict of saved) await app.given.verdict(verdict);
    await app.given.trackMark({
      releaseId: FIRST_RECORD.id,
      position: grail!.position,
      mark: "candidate",
    });
    await settings.open();
    await settings.sandbox.getByRole("button", { name: "Back to the sandbox" }).click();
    await expect(
      settings.sandbox.getByRole("button", { name: "Turn off the sandbox" }),
    ).toBeVisible();
    await header.goTo("triage");
    const sandboxKey = await triage.currentKey();
    await triage.judgeInSandbox("accepted");
    await header.goTo("settings");
    await expect(settings.exports).toContainText(
      "The sandbox verdicts in this tab are not saved, so they are not in them.",
    );

    const json = await app.expectDownload(() =>
      settings.exports.getByRole("link", { name: "verdicts and track marks (JSON)" }).click(),
    );
    const verdictsCsv = await app.expectDownload(() =>
      settings.exports.getByRole("link", { name: "verdicts (CSV)" }).click(),
    );
    const marksCsv = await app.expectDownload(() =>
      settings.exports.getByRole("link", { name: "track marks (CSV)" }).click(),
    );

    expect(json.name).toMatch(/^digga-\d{4}-\d{2}-\d{2}-decisions\.json$/);
    const decisions = JSON.parse(fs.readFileSync(json.path, "utf8")) as DecisionsExport;
    expect(decisions.verdicts.map(({ key, status }) => ({ key, status }))).toEqual(
      expect.arrayContaining(saved.map(({ key, status }) => ({ key, status }))),
    );
    expect(decisions.verdicts).toHaveLength(saved.length);
    expect(decisions.trackMarks).toEqual([
      expect.objectContaining({
        releaseId: FIRST_RECORD.id,
        position: grail!.position,
        mark: "candidate",
      }),
    ]);

    expect(verdictsCsv.name).toMatch(/^digga-\d{4}-\d{2}-\d{2}-verdicts\.csv$/);
    const verdictRows = csvRows(verdictsCsv.path);
    expect(verdictRows.map((row) => row.slice(0, 2))).toEqual(
      expect.arrayContaining(saved.map(({ key, status }) => [key, status])),
    );
    expect(verdictRows).toHaveLength(saved.length);
    expect(verdictRows.map((row) => row[0])).not.toContain(sandboxKey);

    expect(marksCsv.name).toMatch(/^digga-\d{4}-\d{2}-\d{2}-track-marks\.csv$/);
    expect(csvRows(marksCsv.path).map((row) => row.slice(0, 2))).toEqual([
      [grail!.position, "candidate"],
    ]);
  },
);

/** Starts the update with its download held part-way; returns the job's id once the row shows it. */
async function startHeldUpdate(settings: SettingsPage, fakes: FakeServices): Promise<string> {
  fakes.dumps.holdAt("part-way");
  const update = await settings.startJob(
    settings.jobs.getByRole("button", { name: "Update from the newest dump" }),
  );
  await expect.poll(() => fakes.dumps.sentBytes).toBe(fakes.dumps.checkpoint("part-way").offset);
  await settings.waitForJob(update, "running");
  return update;
}

async function jobIds(app: DiggaApp): Promise<string[]> {
  const { jobs } = await app.api.get<JobsResponse>("/api/jobs");
  return jobs.map((job) => job.id);
}

/** The first problem validateConfig finds, as the field shows it and as the save bar does. */
function problemOf(config: Config): { message: string; line: string } {
  const validation = validateConfig(config);
  if (validation.ok) throw new Error("the config is valid");
  return { message: validation.issues[0]!.message, line: validation.errors[0]! };
}

async function expectProblem(
  settings: SettingsPage,
  field: Locator,
  problem: { message: string; line: string },
): Promise<void> {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await field.evaluate((input) => input.matches(":invalid"))).toBe(true);
  await expect(settings.root.getByText(problem.line, { exact: true })).toBeVisible();
  await expect(settings.root.getByText(problem.message, { exact: true })).toBeVisible();
  await expect(settings.saveButton).toBeDisabled();
}

async function expectNoProblem(field: Locator): Promise<void> {
  await expect(field).not.toHaveAttribute("aria-invalid");
  expect(await field.evaluate((input) => input.matches(":invalid"))).toBe(false);
}

/** The buttons a running dump job disables: the jobs that write the folder, and each Delete. */
function dumpButtons(settings: SettingsPage, dumps: string[]) {
  const jobs = ["Update from the newest dump", "Download only", "Load"].map((name) =>
    settings.jobs.getByRole("button", { name, exact: true }),
  );
  return [...jobs, ...dumps.map((name) => settings.deleteButton(name))];
}

/** The rows of an exported CSV after its header; Digga's exports quote no value used here. */
function csvRows(file: string): string[][] {
  const [, ...rows] = fs.readFileSync(file, "utf8").trim().split("\n");
  return rows.map((row) => row.split(","));
}

/** Where the fake player that plays with sound is, in seconds. */
async function audibleTime(app: DiggaApp): Promise<number | undefined> {
  const audible = await app.youtube.audible();
  const players = await app.youtube.players();
  return players.find((player) => player.videoId === audible && !player.muted)?.time;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runs the action and returns the queue the page reads after it. */
async function queueAfter(app: DiggaApp, action: () => Promise<unknown>): Promise<QueueResponse> {
  const read = app.page.waitForResponse((response) => isRequest(response, "GET", "/api/queue"));
  await action();
  const response = await read;
  expect(response.ok()).toBe(true);
  return (await response.json()) as QueueResponse;
}

function keysOf(queue: QueueResponse): string[] {
  return queue.items.map((item) => item.triageKey);
}

function backups(app: DiggaApp): Promise<BackupsResponse> {
  return app.api.get<BackupsResponse>("/api/backups");
}
