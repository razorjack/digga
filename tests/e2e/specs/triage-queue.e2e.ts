import { STATUS_COPY } from "../../../src/client/keymap.ts";
import { endOfQueueHeadline } from "../../../src/client/triage/end-of-queue.ts";
import type { DecisionsExport, QueueItem, QueueResponse, Stats } from "../../../src/shared/api.ts";
import { formatCount, formatPrice } from "../../../src/shared/display.ts";
import { youtubeWatchUrl } from "../../../src/shared/youtube.ts";
import {
  COMPILATION,
  ECHO_CHAMBER,
  FIRST_RECORD,
  MAIN_PRESSING,
  ROLLERS_ARCHIVE,
  SELF_RELEASE,
  SELF_RELEASED,
  SHOP_PRESSING,
  SHOPKEEPER,
  TEMPEST_AUDIO,
  triageKeyOf,
  WITHOUT_VIDEOS,
  YOUTUBE_ONLY,
} from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { HeaderPage } from "../pages/header.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

// Triage's queue: its end, rounds of snoozed records, hidden labels, scopes and batches
// (docs/e2e/scenarios/triage.md).

/** A label with two records, BLT 010 and BLT 011, and nothing after them. */
const TWO_RECORDS = ["Bassline Theory"];

test.describe("digging a label of two records", () => {
  test.use({ diggaOptions: { labels: TWO_RECORDS } });

  test(
    "TRI-09 N passes a record, which comes round again from the end of the queue",
    { tag: ["@TRI-09", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();

      const passed = await triage.currentKey();
      await triage.pass();
      await expect(triage.lastAction).toContainText("later");
      await expect(triage.lastAction).toContainText("Stays in the queue for another go.");
      await triage.judge("rejected");

      await expect(triage.root.getByText("all dug", { exact: true })).toBeVisible();
      await expect(triage.root.getByText(endOfQueueHeadline(1), { exact: true })).toBeVisible();
      await expect(
        triage.root.getByRole("button", { name: "go round the 1 you passed" }),
      ).toBeVisible();
      await triage.goRound();
      await expect(triage.record).toHaveAttribute("data-triage-key", passed);
    },
  );

  test(
    "TRI-30 the end of the queue starts a round of the snoozed records: a verdict replaces a snooze, N leaves it, Esc returns",
    { tag: ["@TRI-30", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const snoozed = await snoozeLabelAndFirstRecord(app);
      await app.open();

      await expect(triage.root.getByText("all dug", { exact: true })).toBeVisible();
      await expect(triage.root.getByText(endOfQueueHeadline(0), { exact: true })).toBeVisible();
      await triage.hearSnoozed();
      await expect(triage.banner).toContainText("Hearing snoozed records again: 3 of 3 left.");

      const judged = await triage.currentKey();
      await triage.judge("rejected");
      await expect(triage.banner).toContainText("2 of 3 left.");
      const left = await triage.currentKey();
      await triage.pass();
      await expect(triage.lastAction).toContainText("Stays snoozed.");
      await expect(triage.banner).toContainText("1 of 3 left.");
      await triage.leaveRound();

      await expect(
        triage.root.getByRole("button", { name: "hear the 2 snoozed again" }),
      ).toBeVisible();
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      const verdicts = exported.verdicts.filter((verdict) => snoozed.has(verdict.key));
      // The verdict keeps the note the snooze had.
      expect(verdicts).toContainEqual(
        expect.objectContaining({ key: judged, status: "rejected", notes: snoozed.get(judged) }),
      );
      expect(verdicts).toContainEqual(expect.objectContaining({ key: left, status: "snoozed" }));
      expect(verdicts.filter((verdict) => verdict.status === "snoozed")).toHaveLength(2);
    },
  );
});

/** Snoozes the label's two records and the first record, each with a note, a day apart. */
async function snoozeLabelAndFirstRecord(app: DiggaApp): Promise<Map<string, string>> {
  const queue = await app.api.get<QueueResponse>("/api/queue?limit=10");
  const records: Pick<QueueItem, "id" | "triageKey" | "title">[] = [
    { id: FIRST_RECORD.id, triageKey: triageKeyOf(FIRST_RECORD), title: FIRST_RECORD.title },
    ...queue.items,
  ];
  const notes = new Map<string, string>();
  for (const [index, record] of records.entries()) {
    const note = `snoozed: ${record.title}`;
    await app.given.verdict({
      key: record.triageKey,
      status: "snoozed",
      releaseId: record.id,
      decidedAt: `2026-09-0${index + 1}T12:00:00.000Z`,
    });
    await app.given.note(record.id, note);
    notes.set(record.triageKey, note);
  }
  return notes;
}

test.describe("digging a self-release label, then a compilation's label", () => {
  test.use({ diggaOptions: { labels: [SELF_RELEASED.name, ROLLERS_ARCHIVE.name] } });

  test(
    "TRI-19 X hides the record's first label from the queue and Settings lists it; Z lets it back",
    { tag: ["@TRI-19", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      const label = SELF_RELEASED.name;
      await app.open();
      const hidden = await triage.currentKey();
      expect(hidden).toBe(triageKeyOf(SELF_RELEASE));

      await triage.hideLabel();
      await expect(triage.lastAction).toContainText("label hidden");
      await expect(triage.lastAction).toContainText(
        `Every record on ${label} is out of the queue; Settings lists the hidden labels.`,
      );
      await expect(triage.record).toHaveAttribute("data-release-id", String(COMPILATION.id));
      expect(await labelsInQueue(app)).toEqual([ROLLERS_ARCHIVE.name]);

      await header.goTo("settings");
      const hiddenLabels = app.page.getByLabel("Hidden labels");
      await expect.poll(async () => (await hiddenLabels.inputValue()).split("\n")).toContain(label);
      await header.goTo("triage");
      await triage.undoLabel();
      await expect(triage.record).toHaveAttribute("data-triage-key", hidden);
      await expect(triage.lastAction).toContainText("Its label is back in the queue.");
      expect(await labelsInQueue(app)).toEqual([label, ROLLERS_ARCHIVE.name]);
    },
  );
});

/** The labels the queue holds records of, in its order, once each. */
async function labelsInQueue(app: DiggaApp): Promise<string[]> {
  const queue = await app.api.get<QueueResponse>("/api/queue?limit=50");
  return [...new Set(queue.items.map((item) => item.labelName ?? ""))];
}

test.describe("digging a compilation's label, then another", () => {
  test.use({ diggaOptions: { labels: [ROLLERS_ARCHIVE.name, TEMPEST_AUDIO.name] } });

  test(
    "TRI-20 F offers the record's labels, its track artists and the last load's records; Enter digs the first label until Esc",
    { tag: ["@TRI-20", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const stats = await app.api.get<Stats>("/api/stats");
      const label = ROLLERS_ARCHIVE.name;
      await app.open();
      await expect(triage.record).toHaveAttribute("data-release-id", String(COMPILATION.id));

      await triage.openScopePicker();
      const onRecord = triage.scopePicker.getByRole("group", { name: "On this record" });
      // The release credits Various, which is not offered; its tracks credit the artists.
      const trackArtists = COMPILATION.tracks.flatMap((track) => track.artists);
      const offered = [`${label} label`, ...trackArtists.map((artist) => `${artist} artist`)];
      await expect(onRecord.getByRole("radio")).toHaveCount(offered.length);
      for (const name of offered)
        await expect(onRecord.getByRole("radio", { name, exact: true })).toBeVisible();
      await expect(onRecord.getByRole("radio", { name: `${label} label` })).toBeChecked();
      const added = triage.scopePicker.getByRole("group", { name: "Added by the last dump load" });
      await expect(added.getByRole("radio")).toHaveAccessibleName(
        new RegExp(`${formatCount(stats.dump.lastLoad!.toDig)} to dig$`),
      );

      await triage.digScope();
      await expect(triage.banner).toHaveText(
        `Digging the label ${label}: 2 left under your filters.`,
      );
      await triage.judge("rejected");
      await expect(triage.banner).toHaveText(
        `Digging the label ${label}: 1 left under your filters.`,
      );
      await expect(triage.record.getByText(label, { exact: true })).toBeVisible();
      await triage.judge("rejected");
      await expect(
        triage.root.getByText(`Nothing is left to dig from the label ${label}.`),
      ).toBeVisible();

      await triage.leaveScope();
      await expect(triage.record).toHaveAttribute("data-release-id", String(MAIN_PRESSING.id));
    },
  );
});

test.describe("with filters that match nothing", () => {
  test.use({ diggaOptions: { config: { filters: { yearFrom: 2030, yearTo: 2031 } } } });

  test(
    "TRI-32 filters that match no record say so, with the number of records loaded",
    { tag: ["@TRI-32", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const stats = await app.api.get<Stats>("/api/stats");
      await app.open();

      await expect(triage.root.getByText("Your filters match no records.")).toBeVisible();
      await expect(
        triage.root.getByText(`${formatCount(stats.universe.keys)} records are loaded.`),
      ).toBeVisible();
      await expect(
        triage.root.getByRole("button", { name: "settings", exact: true }),
      ).toHaveAttribute("aria-keyshortcuts", ",");
      await expect(triage.record).toHaveCount(0);
    },
  );
});

test(
  "TRI-33 a tracklist that did not load says so, and Enter loads it",
  { tag: ["@TRI-33", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    app.expectProblems({
      aborted: [new RegExp(`^GET /api/releases/${FIRST_RECORD.id}$`)],
      consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
    });
    await app.abortRequests({ method: "GET", path: `/api/releases/${FIRST_RECORD.id}` });
    await app.open();

    await expect(triage.root.getByText(/^The tracklist did not load: \S/)).toBeVisible();
    await expect(triage.tracklist).toBeHidden();
    await triage.retryTracklist();
    for (const track of FIRST_RECORD.tracks)
      await expect(triage.track(track.position)).toContainText(track.title);
  },
);

test.describe("with a queue batch of five", () => {
  test.use({ diggaOptions: { config: { queue: { limit: 5 } } } });

  test(
    "TRI-34 digging past the first batch finds the next record waiting",
    { tag: ["@TRI-34", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const queue = await queueAhead(app);
      await app.open();

      for (const [index, record] of queue.slice(0, 7).entries()) {
        await expectBuffered(triage, record, queue[index + 1]!);
        await triage.judge("rejected");
      }

      const queueRequests = app.apiRequests().filter((request) => request === "GET /api/queue");
      expect(queueRequests.length).toBeGreaterThan(1);
    },
  );
});

test.describe("in the sandbox, with a queue batch of five", () => {
  test.use({ diggaOptions: { sandbox: true, config: { queue: { limit: 5 } } } });

  test(
    "TRI-34 in the sandbox, digging past the first batch finds the next record waiting",
    { tag: ["@TRI-34", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const queue = await queueAhead(app);
      await app.open();

      for (const [index, record] of queue.slice(0, 7).entries()) {
        await expectBuffered(triage, record, queue[index + 1]!);
        await triage.judgeInSandbox("rejected");
        await expect(triage.lastAction).toContainText(STATUS_COPY.rejected);
      }

      expect(app.apiRequests()).not.toContain("POST /api/verdicts");
    },
  );
});

test.describe("digging Echo Chamber", () => {
  test.use({ diggaOptions: { labels: [ECHO_CHAMBER.name] } });

  const sentBack = triageKeyOf(WITHOUT_VIDEOS);
  const sentBackName = `${WITHOUT_VIDEOS.artists.join(", ")} – ${WITHOUT_VIDEOS.title}`;

  test(
    "TRI-44 a record judged D in Triage and given a link in Twelves comes next when Triage is shown again",
    { tag: ["@TRI-44", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();
      await triage.judge("rejected");
      expect(await triage.currentKey()).toBe(sentBack);
      await triage.judge("no_audio");
      const onScreen = await triage.currentKey();

      await new HeaderPage(app).goTo("twelves");
      await attachLinkOnNoAudioShelf(app);
      await triage.showAgain();

      await expectSentBackNext(triage, onScreen);
    },
  );

  test(
    "TRI-44 a record judged D before Triage opened and given a link in Twelves comes next when Triage is shown",
    { tag: ["@TRI-44", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.given.verdicts(datedVerdicts([{ release: WITHOUT_VIDEOS, status: "no_audio" }]));
      // Triage reads its queue when the app opens, also on another page.
      const queueRead = app.page.waitForResponse((response) =>
        isRequest(response, "GET", "/api/queue"),
      );
      await new TwelvesPage(app).open();
      await (await queueRead).finished();

      await attachLinkOnNoAudioShelf(app);
      await triage.showAgain();

      await expectSentBackNext(triage, await triage.currentKey());
    },
  );

  async function attachLinkOnNoAudioShelf(app: DiggaApp): Promise<void> {
    const twelves = new TwelvesPage(app);
    await twelves.showShelf("no_audio");
    expect(await twelves.selectedKey()).toBe(sentBack);
    await twelves.attachVideo(youtubeWatchUrl(YOUTUBE_ONLY.staticTrack.id));
  }

  /** The record on screen stays, the record sent back is next, and it has the pasted video. */
  async function expectSentBackNext(triage: TriagePage, onScreen: string): Promise<void> {
    await expect(triage.record).toHaveAttribute("data-triage-key", onScreen);
    await expect(triage.upNext).toContainText(sentBackName);
    await triage.judge("rejected");
    await expect(triage.record).toHaveAttribute("data-triage-key", sentBack);
    await expect(triage.track(WITHOUT_VIDEOS.tracks[0]!.position)).toContainText(
      /has a video|playing/,
    );
  }
});

/** The first ten records of the queue, more than two batches of five. */
async function queueAhead(app: DiggaApp): Promise<QueueItem[]> {
  return (await app.api.get<QueueResponse>("/api/queue?limit=10")).items;
}

/** The record is on screen and the one after it is already "Up next", so no batch leaves a gap. */
async function expectBuffered(triage: TriagePage, record: QueueItem, next: QueueItem) {
  await expect(triage.record).toHaveAttribute("data-triage-key", record.triageKey);
  await expect(triage.upNext).toContainText(`${next.artistDisplay} – ${next.title}`);
}

test(
  "TRI-21 one Esc closes the picker while its search field holds text",
  { tag: ["@TRI-21", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    await triage.openScopePicker();
    await triage.searchScopes("zzq");

    await triage.closeScopePicker();
    await expect(triage.banner).toBeHidden();

    await triage.openScopePicker();
    await expect(triage.scopeSearch).toHaveValue("");
    await expect(triage.scopePicker.getByRole("group", { name: "On this record" })).toBeVisible();
  },
);

test.describe("with a Discogs account and shopkeeper's shop read", () => {
  test.use({ diggaOptions: { template: "small-account", savedToken: "e2e-token-dj" } });

  test.beforeEach(async ({ app }) => {
    await app.given.sellerShop(SHOPKEEPER.username);
  });

  test(
    "TRI-21 F's search lists sellers first, then labels and artists with their records; no match says so",
    { tag: ["@TRI-21", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();
      await triage.openScopePicker();

      await triage.searchScopes("ke");
      const matches = triage.scopePicker.getByRole("group", { name: "Matches" });
      // The seller first, although Kestrel has more records: two of their own and a compilation's track.
      await expect(matches).toMatchAriaSnapshot(`
        - radio "shopkeeper seller, 1 record" [checked]
        - radio "Kestrel artist, 3 records"
      `);
      await expect(triage.scopeStatus).toHaveText("2 matches, most records first.");
      await app.page.keyboard.press("ArrowDown");
      await expect(matches.getByRole("radio", { name: /^shopkeeper/ })).toBeFocused();
      await app.page.keyboard.press("ArrowDown");
      await expect(matches.getByRole("radio", { name: /^Kestrel/ })).toBeChecked();

      await triage.scopeSearch.focus();
      await triage.searchScopes("zzq");
      await expect(triage.scopeStatus).toHaveText(
        "Nothing matches “zzq”. A seller's shop is read in Settings, under Jobs.",
      );
      await expect(triage.scopePicker.getByRole("radio")).toHaveCount(0);
      await triage.closeScopePicker();
    },
  );

  test(
    "TRI-40 digging a seller's shop shows the pressing they have, and A wants that pressing",
    { tag: ["@TRI-40", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const queue = await app.api.get<QueueResponse>("/api/queue?limit=50");
      const pressing = queue.items.find((item) => item.triageKey === triageKeyOf(SHOP_PRESSING));
      // The whole queue shows the master's main release.
      expect(pressing?.id).toBe(MAIN_PRESSING.id);
      await app.open();

      await triage.openScopePicker();
      await triage.searchScopes("shop");
      await expect(
        triage.scopePicker.getByRole("radio", { name: "shopkeeper seller, 1 record" }),
      ).toBeChecked();
      await triage.digScope();
      await expect(triage.banner).toHaveText(
        "Digging the seller shopkeeper: 1 left under your filters.",
      );
      await expect(triage.record).toHaveAttribute("data-release-id", String(SHOP_PRESSING.id));
      const copy = SHOPKEEPER.inventory[0]!;
      await expect(triage.sellerCopies).toHaveAccessibleName("shopkeeper sells");
      await expect(triage.sellerCopies.getByRole("listitem")).toHaveText([
        // The stamp, then what a screen reader reads instead of it.
        `${formatPrice(copy.price, SHOPKEEPER.currency)} NM / Generic record ${copy.condition}, sleeve ${copy.sleeveCondition} ${copy.comments}`,
      ]);

      const response = await triage.judgeAndPush("accepted");
      expect(response.ok()).toBe(true);
      expect(fakes.requests("PUT /users/:user/wants/:id").map((request) => request.params)).toEqual(
        [{ user: "dj", id: String(SHOP_PRESSING.id) }],
      );
    },
  );
});
