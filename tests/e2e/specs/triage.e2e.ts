import { STATUS_COPY, type TriageStatus } from "../../../src/client/keymap.ts";
import {
  type DecisionsExport,
  type Stats,
  TWELVES_STATUSES,
  type TwelvesResponse,
} from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { startSeconds } from "../../../src/shared/playlist.ts";
import { isWantlistVerdict } from "../../../src/shared/wantlist.ts";
import { releaseById } from "../fixtures/catalogue.ts";
import { isRequest, PAST_PUSH_GRACE_MS, TriagePage } from "../pages/triage.ts";
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
