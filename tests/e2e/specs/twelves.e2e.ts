import {
  EMPTY,
  MARK_COPY,
  PAGE_SIZE,
  type ShelfId,
  SHELVES,
} from "../../../src/client/twelves/model.ts";
import type { DecisionsExport, QueueResponse } from "../../../src/shared/api.ts";
import { STATUS_COPY } from "../../../src/client/keymap.ts";
import { rejudgedSentence } from "../../../src/client/twelves/model.ts";
import { discogsReleaseUrl } from "../../../src/shared/discogs-urls.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { youtubeSearchUrl, youtubeWatchUrl } from "../../../src/shared/youtube.ts";
import {
  BULK,
  DJ,
  ECHO_CHAMBER,
  EVENT_HORIZON,
  FIRST_RECORD,
  NOT_IN_ANY_DUMP,
  SECOND_RECORD,
  SMALL,
  THIRD_RECORD,
  TRACK_RUN,
  triageKeyOf,
  WITHOUT_VIDEOS,
  YOUTUBE_ONLY,
} from "../fixtures/catalogue.ts";
import { bulkVerdicts, datedVerdicts, decisionsBackup } from "../fixtures/decisions.ts";
import { TriagePage } from "../pages/triage.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { judgeKey, TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

// Twelves without Discogs: the shelves, moving and sorting, the filter, notes, a round of snoozed
// records, the Tracks shelf and the No audio shelf (docs/e2e/scenarios/twelves.md).

test.describe("on an account's library", () => {
  test.use({ diggaOptions: { template: "small-account" } });

  test(
    "TWL-01 keys 1 to 9 pick the shelves with their counts; Everything leaves out no audio",
    { tag: ["@TWL-01", "@P1"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      await app.given.verdicts(
        datedVerdicts([
          { release: FIRST_RECORD, status: "accepted" },
          { release: SECOND_RECORD, status: "maybe" },
          { release: THIRD_RECORD, status: "snoozed" },
          { release: WITHOUT_VIDEOS, status: "no_audio" },
        ]),
      );
      const [keep, meh] = FIRST_RECORD.tracks;
      await app.given.trackMark({
        releaseId: FIRST_RECORD.id,
        position: keep!.position,
        mark: "keep",
      });
      await app.given.trackMark({
        releaseId: FIRST_RECORD.id,
        position: meh!.position,
        mark: "meh",
      });
      // The template imported dj's collection and wantlist; no grail is given.
      const counts: Record<ShelfId, number> = {
        all: 3 + DJ.collection.length + DJ.wantlist.length,
        accepted: 1,
        wantlist: DJ.wantlist.length,
        collection: DJ.collection.length,
        maybe: 1,
        candidate: 0,
        snoozed: 1,
        tracks: 1,
        no_audio: 1,
      };
      await twelves.open();

      for (const shelf of SHELVES) {
        await twelves.showShelf(shelf.id);
        await expect(twelves.shelfOption(shelf.id)).toHaveAccessibleName(
          `${shelf.label} ${formatCount(counts[shelf.id])}`,
        );
        if (counts[shelf.id] === 0)
          await expect(twelves.root.getByText(EMPTY[shelf.id], { exact: true })).toBeVisible();
        else if (shelf.id === "tracks")
          await expect(twelves.track(FIRST_RECORD.id, keep!.position)).toBeVisible();
        else await expect(twelves.records).toHaveCount(counts[shelf.id]);
      }

      await twelves.showShelf("all");
      await expect(twelves.records.first()).toBeVisible();
      await expect(twelves.record(triageKeyOf(WITHOUT_VIDEOS))).toHaveCount(0);
      await twelves.showShelf("no_audio");
      await expect(twelves.record(triageKeyOf(WITHOUT_VIDEOS))).toBeVisible();
    },
  );
});

/** Every small record once, the main release standing for its master; snoozed a day apart. */
async function snoozeEverySmallRecord(app: DiggaApp): Promise<string[]> {
  const records = SMALL.filter(
    (fixture, index) =>
      SMALL.findIndex((other) => triageKeyOf(other) === triageKeyOf(fixture)) === index,
  );
  await app.given.verdicts(
    datedVerdicts(records.map((release) => ({ release, status: "snoozed" }))),
  );
  return records.map((fixture) => triageKeyOf(fixture));
}

test(
  "TWL-02 J, K, the down and up arrows move the selection and scroll it into the window",
  { tag: ["@TWL-02", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    const keys = await snoozeEverySmallRecord(app);
    await twelves.open();
    expect(await twelves.selectedKey()).toBe(keys[0]);

    expect(await twelves.move("j")).toBe(keys[1]);
    expect(await twelves.move("ArrowDown")).toBe(keys[2]);
    expect(await twelves.move("k")).toBe(keys[1]);
    expect(await twelves.move("ArrowUp")).toBe(keys[0]);

    // The rows stop above the shelf's sticky footer, which covers the window's bottom edge.
    await twelves.select(keys.at(-1)!);
    await expect(twelves.selected).toBeInViewport();
    await expect.poll(() => twelves.isUncovered(twelves.selected)).toBe(true);
    await twelves.select(keys[0]!);
    await expect(twelves.selected).toBeInViewport();
    await expect.poll(() => twelves.isUncovered(twelves.selected)).toBe(true);
  },
);

test(
  "TWL-02 a track J selects at the bottom of a short window stays above the shelf's footer",
  { tag: ["@TWL-02", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    await app.given.verdicts(datedVerdicts([{ release: TRACK_RUN, status: "accepted" }]));
    for (const track of TRACK_RUN.tracks)
      await app.given.trackMark({
        releaseId: TRACK_RUN.id,
        position: track.position,
        mark: "keep",
      });
    // Five rows fill a short window, so the last one has to scroll.
    await app.page.setViewportSize({ width: 1600, height: 480 });
    await twelves.open();
    await twelves.showShelf("tracks");

    const rows = twelves.root.locator(`tr[data-release-id="${TRACK_RUN.id}"]`);
    await expect(rows).toHaveCount(TRACK_RUN.tracks.length);
    const last = rows.last();
    await expect(last).not.toBeInViewport();
    for (let step = 1; step < TRACK_RUN.tracks.length; step += 1)
      await app.page.keyboard.press("j");
    await expect(last).toHaveAttribute("aria-current", "true");

    await expect(last).toBeInViewport();
    await expect.poll(() => twelves.isUncovered(last)).toBe(true);
  },
);

/** Restored with `digga restore` before the server starts; Twelves lists them in catalogue order. */
const RESTORED_VERDICTS = 1200;

test.describe("with 1,200 verdicts on the bulk catalogue", () => {
  test.use({
    diggaOptions: {
      template: "bulk",
      decisionsBackup: decisionsBackup(bulkVerdicts(RESTORED_VERDICTS, "snoozed")),
    },
  });

  test(
    "TWL-03 a shelf shows 500 rows a page; the arrows turn pages and J crosses into the next",
    { tag: ["@TWL-03", "@P1"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      const keys = BULK.slice(0, RESTORED_VERDICTS).map((fixture) => triageKeyOf(fixture));
      await twelves.open();
      await expect(twelves.records).toHaveCount(PAGE_SIZE);
      await expect(twelves.pager).toContainText("1–500 of 1,200 records");
      await expect(twelves.pager.getByRole("button", { name: "Previous page" })).toBeDisabled();
      expect(await twelves.selectedKey()).toBe(keys[0]);

      expect(await twelves.turnPage("ArrowRight")).toBe(keys[PAGE_SIZE]);
      await expect(twelves.pager).toContainText("501–1,000 of 1,200 records");
      await expect(twelves.shelf("all")).toHaveAccessibleName("Everything, 501 to 1,000 of 1,200");
      await expect(twelves.records).toHaveCount(PAGE_SIZE);
      expect(await twelves.move("k")).toBe(keys[PAGE_SIZE - 1]);
      await expect(twelves.pager).toContainText("1–500 of 1,200 records");
      expect(await twelves.move("j")).toBe(keys[PAGE_SIZE]);
      await expect(twelves.pager).toContainText("501–1,000 of 1,200 records");

      expect(await twelves.turnPage("ArrowRight")).toBe(keys[2 * PAGE_SIZE]);
      await expect(twelves.records).toHaveCount(RESTORED_VERDICTS - 2 * PAGE_SIZE);
      await expect(twelves.pager).toContainText("1,001–1,200 of 1,200 records");
      await expect(twelves.pager.getByRole("button", { name: "Next page" })).toBeDisabled();
      expect(await twelves.turnPage("ArrowLeft")).toBe(keys[PAGE_SIZE]);
      await expect(twelves.pager).toContainText("501–1,000 of 1,200 records");
    },
  );
});

test("TWL-04 S changes the order of the rows", { tag: ["@TWL-04", "@P1"] }, async ({ app }) => {
  const twelves = new TwelvesPage(app);
  // Newest first is the reverse of the labels' order.
  const newestFirst = [EVENT_HORIZON, SECOND_RECORD, FIRST_RECORD];
  await app.given.verdicts(
    datedVerdicts(newestFirst.map((release) => ({ release, status: "snoozed" }))),
  );
  await twelves.open();
  await expect(twelves.sortOption("newest")).toBeChecked();
  expect(await twelves.recordKeys()).toEqual(newestFirst.map((fixture) => triageKeyOf(fixture)));

  expect(await twelves.cycleSort()).toBe("label");

  await expect
    .poll(() => twelves.recordKeys())
    .toEqual(newestFirst.toReversed().map((fixture) => triageKeyOf(fixture)));
});

test(
  "TWL-05 / focuses the filter, which filters by label; Enter leaves it, Esc clears it",
  { tag: ["@TWL-05", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    await app.given.verdicts(
      datedVerdicts([
        { release: FIRST_RECORD, status: "snoozed" },
        { release: SECOND_RECORD, status: "snoozed" },
        { release: THIRD_RECORD, status: "snoozed" },
      ]),
    );
    await twelves.open();
    await expect(twelves.records).toHaveCount(3);

    // Both of Bassline Theory's records, and not the first record, on Axis Plate.
    await twelves.filterBy("bassline");
    await expect
      .poll(() => twelves.recordKeys())
      .toEqual([triageKeyOf(SECOND_RECORD), triageKeyOf(THIRD_RECORD)]);
    await twelves.leaveFilter();
    await expect(twelves.filter).toHaveValue("bassline");
    expect(await twelves.move("j")).toBe(triageKeyOf(THIRD_RECORD));

    await twelves.filterBy(" theory zz");
    await expect(
      twelves.root.getByText("Nothing matches “bassline theory zz”.", { exact: true }),
    ).toBeVisible();
    await twelves.clearFilter();
    await expect(twelves.records).toHaveCount(3);
  },
);

test(
  "TWL-06 E edits a note, Enter saves it, an empty note removes it, and both survive a reload",
  { tag: ["@TWL-06", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    const oldNote = "check the B side";
    const newNote = "bought at Ninja";
    await app.given.verdicts(
      datedVerdicts([
        { release: FIRST_RECORD, status: "snoozed" },
        { release: SECOND_RECORD, status: "snoozed" },
      ]),
    );
    await app.given.note(SECOND_RECORD.id, oldNote);
    const first = twelves.record(triageKeyOf(FIRST_RECORD));
    const second = twelves.record(triageKeyOf(SECOND_RECORD));
    await twelves.open();
    expect(await twelves.selectedKey()).toBe(triageKeyOf(FIRST_RECORD));

    await twelves.writeNote(newNote);
    await expect(first).toContainText(newNote);
    await twelves.move("j");
    await twelves.openNote();
    await expect(twelves.noteField).toHaveValue(oldNote);
    await app.page.keyboard.press("Escape");
    await expect(twelves.noteField).toBeHidden();
    await expect(second).toContainText(oldNote);
    await twelves.writeNote("");
    await expect(second).not.toContainText(oldNote);

    await twelves.reload();
    await expect(first).toContainText(newNote);
    await expect(second).toBeVisible();
    await expect(second).not.toContainText(oldNote);
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: triageKeyOf(FIRST_RECORD), notes: newNote }),
        expect.objectContaining({ key: triageKeyOf(SECOND_RECORD), notes: null }),
      ]),
    );
  },
);

test(
  "TWL-12 Enter on a snoozed record hears it and the snoozed records after it in Triage",
  { tag: ["@TWL-12", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    await app.given.verdicts(
      datedVerdicts([
        { release: EVENT_HORIZON, status: "maybe" },
        { release: FIRST_RECORD, status: "snoozed" },
        { release: SECOND_RECORD, status: "snoozed" },
        { release: THIRD_RECORD, status: "snoozed" },
      ]),
    );
    await twelves.open();
    expect(await twelves.selectedKey()).toBe(triageKeyOf(EVENT_HORIZON));

    await twelves.replaySelected(EVENT_HORIZON.id);
    await new TriagePage(app).leaveRound();
    await new HeaderPage(app).goTo("twelves");

    await twelves.showShelf("snoozed");
    await twelves.select(triageKeyOf(SECOND_RECORD));
    await twelves.hearAgain();

    // The round holds the selected record and the one after it on the shelf, not the one before.
    await expect(app.page.getByText(/^Hearing snoozed records again/)).toContainText("2 of 2 left");
  },
);

test(
  "TWL-13 the Tracks shelf lists grail and keep marks with their release and verdict",
  { tag: ["@TWL-13", "@P1"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    const [grail, meh, , kept] = TRACK_RUN.tracks;
    await app.given.verdicts(datedVerdicts([{ release: TRACK_RUN, status: "accepted" }]));
    for (const [track, mark] of [
      [grail!, "candidate"],
      [kept!, "keep"],
      [meh!, "meh"],
    ] as const)
      await app.given.trackMark({ releaseId: TRACK_RUN.id, position: track.position, mark });
    await twelves.open();

    await twelves.showShelf("tracks");
    const grailRow = twelves.track(TRACK_RUN.id, grail!.position);
    const keptRow = twelves.track(TRACK_RUN.id, kept!.position);
    for (const [row, mark] of [
      [grailRow, MARK_COPY.candidate],
      [keptRow, MARK_COPY.keep],
    ] as const) {
      await expect(row.getByText(mark, { exact: true })).toBeVisible();
      await expect(row).toContainText(TRACK_RUN.artists[0]!);
      await expect(row).toContainText(TRACK_RUN.title);
      await expect(row.getByText(STATUS_COPY.accepted, { exact: true })).toBeVisible();
    }
    await expect(twelves.track(TRACK_RUN.id, meh!.position)).toHaveCount(0);

    const position = await twelves.selected.getAttribute("data-position");
    await twelves.writeTrackNote("the bassline at 2:10");
    await expect(twelves.track(TRACK_RUN.id, position!)).toContainText("the bassline at 2:10");

    const requestsBefore = app.apiRequests().length;
    await app.page.keyboard.press("a");
    await expect(twelves.messages).toHaveText(
      "Track marks change in Triage, on the playing track.",
    );
    // The flash comes from the key press itself; nothing was sent for it.
    expect(app.apiRequests().slice(requestsBefore)).toEqual([]);
  },
);

test.describe("on Echo Chamber", () => {
  test.use({ diggaOptions: { labels: [ECHO_CHAMBER.name] } });

  test(
    "TWL-14 on the No audio shelf, Y searches YouTube and a pasted link sends the record back to the queue",
    { tag: ["@TWL-14", "@P1"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(WITHOUT_VIDEOS);
      await app.given.verdicts(datedVerdicts([{ release: WITHOUT_VIDEOS, status: "no_audio" }]));
      await twelves.open();
      await twelves.showShelf("no_audio");
      expect(await twelves.selectedKey()).toBe(key);

      expect(await twelves.searchYouTube()).toBe(
        youtubeSearchUrl(`${WITHOUT_VIDEOS.artists.join(", ")} ${WITHOUT_VIDEOS.title}`),
      );
      await twelves.attachVideo(youtubeWatchUrl(YOUTUBE_ONLY.staticTrack.id));

      await expect(twelves.messages).toHaveText(
        `${WITHOUT_VIDEOS.artists.join(", ")} – ${WITHOUT_VIDEOS.title}: link attached, and back in the queue.`,
      );
      await expect(twelves.root.getByText(EMPTY.no_audio, { exact: true })).toBeVisible();
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).not.toContainEqual(expect.objectContaining({ key }));
      const queue = await app.api.get<QueueResponse>("/api/queue?limit=50");
      expect(queue.items.map((item) => item.triageKey)).toContain(key);
    },
  );
});

test("TWL-15 O opens the release on discogs.com", { tag: ["@TWL-15", "@P2"] }, async ({ app }) => {
  const twelves = new TwelvesPage(app);
  await app.given.verdicts(
    datedVerdicts([
      { release: FIRST_RECORD, status: "snoozed" },
      { release: SECOND_RECORD, status: "maybe" },
    ]),
  );
  await twelves.open();
  await twelves.select(triageKeyOf(SECOND_RECORD));

  const opened = await app.expectExternalOpen(() => app.page.keyboard.press("o"));

  expect(opened).toBe(discogsReleaseUrl(SECOND_RECORD.id));
});

test.describe("with a verdict restored for a release no dump has", () => {
  // dj's second want; a decisions backup restored before the server starts names it.
  test.use({
    diggaOptions: {
      decisionsBackup: decisionsBackup([
        {
          key: triageKeyOf(NOT_IN_ANY_DUMP),
          status: "snoozed",
          source: "triage",
          releaseId: NOT_IN_ANY_DUMP.id,
          decidedAt: "2026-09-29T12:00:00.000Z",
        },
      ]),
    },
  });

  test(
    "TWL-16 a verdict for a release in no dump reads Not in the loaded dump, with its key",
    { tag: ["@TWL-16", "@P2"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(NOT_IN_ANY_DUMP);
      expect(key).toBe(`r:${NOT_IN_ANY_DUMP.id}`);
      await twelves.open();

      const row = twelves.record(key);
      await expect(row).toContainText(`Not in the loaded dump (${key})`);
      await expect(row).not.toHaveAttribute("data-release-id");
      await expect(twelves.stamp(row, "snoozed")).toBeVisible();
      expect(await twelves.selectedKey()).toBe(key);
      await app.page.keyboard.press("Enter");
      await expect(twelves.messages).toHaveText(
        "This record is not in the loaded dump, so Triage cannot play it.",
      );
    },
  );
});

test(
  "TWL-18 the shelf mounts again in the mode the settings name, live as the page opens and in the sandbox once switched",
  { tag: ["@TWL-18", "@P2"] },
  async ({ app }) => {
    const twelves = new TwelvesPage(app);
    const header = new HeaderPage(app);
    const settings = new SettingsPage(app);
    const key = triageKeyOf(FIRST_RECORD);
    const name = `${FIRST_RECORD.artists.join(", ")} – ${FIRST_RECORD.title}`;
    await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));

    // The app starts in the sandbox until the settings say otherwise, and the shelf opened at once
    // with it; the stamp goes as the settings arrive, in the update that mounts the shelf again.
    await twelves.open();
    await expect(header.sandbox).toBeHidden();
    await expect(twelves.root.getByText("Loading…", { exact: true })).toBeHidden();
    expect(await twelves.selectedKey()).toBe(key);
    await twelves.rejudge("maybe");
    expect(await exportedStatus(app, key)).toBe("maybe");

    await header.goTo("settings");
    await settings.switchSandbox("on");
    await header.goTo("twelves");
    await expect(twelves.root.getByText("Loading…", { exact: true })).toBeHidden();
    await app.page.keyboard.press("z");
    await expect(twelves.messages).toHaveText("Nothing to undo.");
    expect(await twelves.selectedKey()).toBe(key);
    const savesBefore = verdictSaves(app);
    await app.page.keyboard.press(judgeKey("snoozed"));
    await expect(twelves.messages).toHaveText(`${rejudgedSentence(name, "snoozed")} Z undoes it.`);
    await expect(twelves.stamp(twelves.record(key), "snoozed")).toBeVisible();
    expect(verdictSaves(app)).toBe(savesBefore);
    expect(await exportedStatus(app, key)).toBe("maybe");
  },
);

function verdictSaves(app: DiggaApp): number {
  return app.apiRequests().filter((request) => request === "POST /api/verdicts").length;
}

async function exportedStatus(app: DiggaApp, key: string): Promise<string | undefined> {
  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  return exported.verdicts.find((verdict) => verdict.key === key)?.status;
}
