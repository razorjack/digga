import fs from "node:fs";
import type { Locator } from "@playwright/test";
import type {
  DecisionsExport,
  DumpsResponse,
  JobsResponse,
  ReleaseDetail,
} from "../../../src/shared/api.ts";
import { type Config, validateConfig } from "../../../src/shared/config.ts";
import { formatBytes, formatDay } from "../../../src/shared/display.ts";
import { startSeconds } from "../../../src/shared/playlist.ts";
import type { Job } from "../../../src/shared/types.ts";
import {
  FIRST_RECORD,
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
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import type { FakeServices } from "../../../tools/dev/fake-services.ts";
import { expect, test } from "../support/test.ts";

// Settings without Discogs: the form, the filter preview, the player, the dumps folder and the
// exports (docs/E2E_TESTING.md, "Settings").

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
  "SET-04 hidden labels: one per line, a saved label leaves the queue, and X's labels show here",
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
      first,
      third,
    ]);
    await header.goTo("triage");
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));

    await triage.hideLabel();
    await header.goTo("settings");

    await expect(settings.hiddenLabels).toHaveValue(
      `${first}\n${third}\n${SECOND_RECORD.label.name}`,
    );
  },
);

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
        notes: "the remix",
      });
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
        notes: "the remix",
      });
    },
  );
});

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
