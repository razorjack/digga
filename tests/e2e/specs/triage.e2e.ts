import { STATUS_COPY, type TriageStatus } from "../../../src/client/keymap.ts";
import {
  type DecisionsExport,
  type QueueResponse,
  type Stats,
  TWELVES_STATUSES,
  type TwelvesResponse,
} from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { startSeconds } from "../../../src/shared/playlist.ts";
import { isWantlistVerdict } from "../../../src/shared/wantlist.ts";
import { FIRST_RECORD, releaseById, SECOND_RECORD } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { isRequest, PAST_PUSH_GRACE_MS, TriagePage, verdictKey } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

const ACCOUNT = { template: "small-account", savedToken: "e2e-token-dj" } as const;

const isWantlistRequest = (request: string) => request.includes("/api/discogs/wantlist/");

test.describe("with the clock", () => {
  test.use({ diggaOptions: { clock: true } });

  test(
    "TRI-02 the player waits for Space, then plays the cued video with sound from its start",
    { tag: ["@TRI-02", "@P0"] },
    async ({ app }) => {
      const settings = await app.api.get<Config>("/api/settings");
      const triage = new TriagePage(app);
      await app.open();
      const release = releaseById(Number(await triage.record.getAttribute("data-release-id")))!;
      const track = release.tracks[0]!;
      const video = release.videos[0]!;
      const startAt = startSeconds(video.seconds, settings.player.startAtFraction);

      await expect(triage.playerStatus("needs_gesture")).toBeVisible();
      await expect(triage.player.getByText("Space start listening", { exact: true })).toBeVisible();
      await expect
        .poll(() => app.youtube.loads())
        .toContainEqual(
          expect.objectContaining({ kind: "cue", videoId: video.id, startSeconds: startAt }),
        );
      expect(await app.youtube.hasActivation()).toBe(false);
      expect(await app.youtube.audible()).toBeNull();

      // Paused, the video's time stays where Space started it.
      await app.clock.pause();
      await triage.startListening();

      expect(await app.youtube.audible()).toBe(video.id);
      const players = await app.youtube.players();
      expect(players.find((player) => player.videoId === video.id && !player.muted)?.time).toBe(
        startAt,
      );
      await expect(triage.player).toContainText(track.title);
      await expect(triage.track(track.position).getByRole("button")).toHaveAttribute(
        "aria-current",
        "true",
      );
    },
  );
});

test.describe("with a Discogs account", () => {
  test.use({ diggaOptions: ACCOUNT });

  test(
    "TRI-07 each verdict key saves its verdict, and wants reach the Discogs wantlist",
    { tag: ["@TRI-07", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const before = await app.api.get<Stats>("/api/stats");
      await app.open();
      const judged = new Map<string, TriageStatus>();
      const pushed: string[] = [];

      for (const status of ["rejected", "accepted", "candidate", "snoozed", "no_audio"] as const) {
        const key = await triage.currentKey();
        const releaseId = await triage.record.getAttribute("data-release-id");
        await triage.judge(status);
        judged.set(key, status);
        await expect(triage.lastAction).toContainText(STATUS_COPY[status]);
        await expect(triage.record).not.toHaveAttribute("data-triage-key", key);
        if (!isWantlistVerdict(status)) continue;
        pushed.push(releaseId!);
        await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      }

      const header = app.page.getByRole("banner");
      await expect(header).toContainText(`${formatCount(before.dug + 5)} dug`);
      await expect(header).toContainText("+5 this session");
      await app.page.reload();
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      const saved = exported.verdicts.filter((verdict) => judged.has(verdict.key));
      expect(Object.fromEntries(saved.map((verdict) => [verdict.key, verdict.status]))).toEqual(
        Object.fromEntries(judged),
      );
      const shelved = await app.api.get<TwelvesResponse>(
        `/api/twelves?status=${TWELVES_STATUSES.join(",")}`,
      );
      const onShelves = shelved.items.filter((item) => judged.has(item.verdict.key));
      expect(onShelves.map((item) => item.verdict.status).toSorted()).toEqual([
        "accepted",
        "candidate",
        "no_audio",
        "snoozed",
      ]);
      expect(fakes.requests("PUT /users/:user/wants/:id").map((request) => request.params)).toEqual(
        pushed.map((id) => ({ user: "dj", id })),
      );
    },
  );
});

test.describe("with a Discogs account and the clock", () => {
  test.use({ diggaOptions: { ...ACCOUNT, clock: true } });

  test(
    "TRI-12 a want pushes the record's note to the Discogs wantlist; a plain want sends no body",
    { tag: ["@TRI-12", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const note = "heard on Kool FM, spring 2001";
      await app.open();
      const noted = await triage.record.getAttribute("data-release-id");
      await triage.writeNote(note);

      // Paused, the push waits for runFor(), so the pending slip can be read.
      await app.clock.pause();
      await triage.judge("accepted");
      await expect(triage.lastAction).toContainText("Adding to your Discogs wantlist…");
      await app.clock.runFor(PAST_PUSH_GRACE_MS);
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");

      const plain = await triage.record.getAttribute("data-release-id");
      await triage.judge("accepted");
      await app.clock.runFor(PAST_PUSH_GRACE_MS);
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");

      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: "dj", id: noted }, body: { notes: note } }),
        expect.objectContaining({ params: { user: "dj", id: plain }, body: null }),
      ]);
    },
  );

  test(
    "TRI-13 Z within the push grace sends nothing to Discogs; Z after the push takes the want off",
    { tag: ["@TRI-13", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      await app.open();
      const key = await triage.currentKey();
      const releaseId = await triage.record.getAttribute("data-release-id");

      // Saving the token asked Discogs whose it is, before the page opened.
      const fakeRequestsBefore = fakes.log.length;
      await app.clock.pause();
      await triage.judge("accepted");
      await triage.undoVerdict(key);
      // The grace timer was armed before Z, so this fires it.
      await app.clock.runFor(PAST_PUSH_GRACE_MS);

      expect(app.apiRequests().filter(isWantlistRequest)).toEqual([]);
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([]);

      await triage.judge("accepted");
      await app.clock.runFor(PAST_PUSH_GRACE_MS);
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      const takenOff = app.page.waitForResponse((response) =>
        isRequest(response, "DELETE", `/api/discogs/wantlist/${releaseId}`),
      );
      await triage.undoVerdict(key);
      const response = await takenOff;
      expect(response.ok()).toBe(true);
      await response.finished();

      await expect(triage.messages).toHaveText("Taken off your Discogs wantlist again.");
      expect(fakes.requests("DELETE /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: "dj", id: releaseId } }),
      ]);
    },
  );
});

test(
  "TRI-01 the first record in label-sweep order shows its facts, its tracks' videos and what comes next",
  { tag: ["@TRI-01", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const queue = await app.api.get<QueueResponse>("/api/queue?limit=2");
    expect(queue.items.map((item) => item.id)).toEqual([FIRST_RECORD.id, SECOND_RECORD.id]);
    const { label } = FIRST_RECORD;

    await app.open();

    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await expect(triage.record.getByText(label.catno, { exact: true })).toBeVisible();
    await expect(triage.record.getByText(label.name, { exact: true })).toBeVisible();
    await expect(triage.record.getByRole("heading", { level: 1 })).toHaveText(
      FIRST_RECORD.artists.join(", "),
    );
    await expect(triage.record.getByText(FIRST_RECORD.title, { exact: true })).toBeVisible();
    const yearAndCountry = `${FIRST_RECORD.year} ${FIRST_RECORD.country}`;
    await expect(triage.record.getByText(yearAndCountry, { exact: true })).toBeVisible();
    // Every fixture release is one 12-inch record (fixtures/dump.ts).
    await expect(triage.record.getByText('Vinyl (12")', { exact: true })).toBeVisible();
    const styles = FIRST_RECORD.styles.join(", ");
    await expect(triage.record.getByText(styles, { exact: true })).toBeVisible();

    const [playing, withVideo, withoutVideo] = FIRST_RECORD.tracks.map((track) => track.position);
    await expect(triage.currentTrack).toHaveAttribute("data-position", playing!);
    await expect(triage.track(withVideo!)).toContainText("has a video");
    await expect(triage.track(withoutVideo!)).toContainText("no video");
    for (const track of FIRST_RECORD.tracks)
      await expect(triage.track(track.position)).toContainText(track.title);

    await expect(triage.upNext).toContainText(SECOND_RECORD.label.catno);
    await expect(triage.upNext).toContainText(
      `${SECOND_RECORD.artists.join(", ")} – ${SECOND_RECORD.title}`,
    );
  },
);

test(
  "TRI-10 Z walks back a verdict, a pass and a hidden label, one per press",
  { tag: ["@TRI-10", "@P0"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();

    const hidden = await triage.currentKey();
    await triage.hideLabel();
    await expect(triage.lastAction).toContainText("label hidden");
    const passed = await triage.currentKey();
    await triage.pass();
    const judged = await triage.currentKey();
    await triage.judge("rejected");

    await triage.undoVerdict(judged);
    await expect(triage.record).toHaveAttribute("data-triage-key", judged);
    await expect(triage.lastAction).toContainText("undone");
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts.map((verdict) => verdict.key)).not.toContain(judged);

    await triage.undoPass(passed);
    await expect(triage.lastAction).toContainText("undone");

    await triage.undoLabel();
    await expect(triage.record).toHaveAttribute("data-triage-key", hidden);
    await expect(triage.lastAction).toContainText("undone");
  },
);

test(
  "TRI-11 a verdict key held down judges one record",
  { tag: ["@TRI-11", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const held = await triage.currentKey();

    await triage.holdVerdictKey("rejected");
    await expect(triage.record).not.toHaveAttribute("data-triage-key", held);
    const next = await triage.currentKey();
    // Verdicts are written in order, so one the repeat made would be saved before this one.
    await triage.judge("rejected");

    const verdictRequests = app.apiRequests().filter((request) => request === "POST /api/verdicts");
    expect(verdictRequests).toHaveLength(2);
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts.map((verdict) => verdict.key).toSorted()).toEqual(
      [held, next].toSorted(),
    );
  },
);

test(
  "TRI-17 E edits the record's note: Enter keeps it, Esc cancels, it survives N and Z, the verdict saves it",
  { tag: ["@TRI-17", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const note = "heard on Kool FM, summer 2000";
    const shownNote = triage.root.getByText(note, { exact: true });
    await app.open();
    const key = await triage.currentKey();
    const release = releaseById(Number(await triage.record.getAttribute("data-release-id")))!;

    await triage.openNote();
    await expect(triage.noteField).toHaveValue("");
    await triage.cancelNote();
    await triage.writeNote(note);
    await triage.openNote();
    await expect(triage.noteField).toHaveValue(note);
    await app.page.keyboard.type(", second set");
    await triage.cancelNote();
    await expect(shownNote).toBeVisible();

    await triage.pass();
    await expect(shownNote).toBeHidden();
    await triage.undoPass(key);
    await expect(shownNote).toBeVisible();

    await triage.judge("snoozed");
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts).toContainEqual(
      expect.objectContaining({ key, status: "snoozed", notes: note }),
    );
    const twelves = new TwelvesPage(app);
    await new HeaderPage(app).goTo("twelves");
    await twelves.showShelf("snoozed");
    await expect(twelves.row("snoozed", release.title)).toContainText(note);
  },
);

test(
  "TRI-08 without a Discogs Maybe list, M points to Settings and saves nothing",
  { tag: ["@TRI-08", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const key = await triage.currentKey();
    await expect(triage.verdictButton("accepted")).toBeVisible();
    await expect(triage.verdictButton("maybe")).toHaveCount(0);

    await app.page.keyboard.press(verdictKey("maybe"));
    await expect(triage.messages).toHaveText(
      "M needs your Discogs Maybe list: pick it in Settings, under Discogs.",
    );
    await expect(triage.record).toHaveAttribute("data-triage-key", key);
    // Verdicts are written in order, so one M had sent would be saved before this one.
    await triage.judge("rejected");

    const verdictRequests = app.apiRequests().filter((request) => request === "POST /api/verdicts");
    expect(verdictRequests).toHaveLength(1);
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts).toEqual([expect.objectContaining({ key, status: "rejected" })]);
  },
);

test.describe("with a Discogs Maybe list", () => {
  // dj's private Maybe list in the fake's design; Triage only needs a list to be chosen.
  test.use({ diggaOptions: { config: { discogs: { maybeListId: 9001 } } } });

  test(
    "TRI-08 with a Discogs Maybe list, the verdict bar offers M, which saves a maybe",
    { tag: ["@TRI-08", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();
      const key = await triage.currentKey();
      await expect(triage.verdictButton("maybe")).toBeVisible();

      await triage.judge("maybe");
      await expect(triage.lastAction).toContainText(STATUS_COPY.maybe);
      await expect(triage.lastAction).toContainText(
        "On the Maybe shelf; add it to your Discogs list from Twelves.",
      );
      await expect(triage.record).not.toHaveAttribute("data-triage-key", key);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toEqual([expect.objectContaining({ key, status: "maybe" })]);
    },
  );
});
