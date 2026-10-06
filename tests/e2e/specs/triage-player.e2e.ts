import type { DecisionsExport, ReleaseDetail } from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatDuration } from "../../../src/shared/display.ts";
import { startSeconds } from "../../../src/shared/playlist.ts";
import { youtubeWatchUrl } from "../../../src/shared/youtube.ts";
import { MARK_COPY } from "../../../src/client/twelves/model.ts";
import {
  ECHO_CHAMBER,
  EMBEDDING_OFF,
  EVERY_VIDEO_REFUSED,
  FIRST_RECORD,
  type FixtureRelease,
  GROUNDWORK,
  ONLY_VIDEO_REFUSED,
  POOLED_MAIN,
  POOLED_REPRESS,
  SAME_TUNE_ELSEWHERE,
  SECOND_RECORD,
  TRACK_RUN,
  TRANSIT_AUDIO,
  WITHOUT_VIDEOS,
  YOUTUBE_ONLY,
} from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { TriagePage, trackMarkKey } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

// Triage's player and tracklist (docs/e2e/scenarios/triage.md).

test(
  "TRI-05 the next release's first video and J's track wait muted on hidden decks, and play without a new load",
  { tag: ["@TRI-05", "@P1"] },
  async ({ app }) => {
    const { startAtFraction } = (await app.api.get<Config>("/api/settings")).player;
    const triage = new TriagePage(app);
    const [first, nextTrack] = FIRST_RECORD.videos;
    const nextRelease = SECOND_RECORD.videos[0]!;
    await app.open();

    await expect(triage.upNext).toContainText("buffered, starts at once");
    for (const video of [nextTrack!, nextRelease])
      await expect
        .poll(() => app.youtube.loads())
        .toContainEqual({
          kind: "load",
          videoId: video.id,
          startSeconds: startSeconds(video.seconds, startAtFraction),
          muted: true,
        });

    await triage.startListening();
    expect(await app.youtube.audible()).toBe(first!.id);
    await triage.nextTrack();
    expect(await app.youtube.audible()).toBe(nextTrack!.id);
    await triage.judge("rejected");
    await expect.poll(() => app.youtube.audible()).toBe(nextRelease.id);

    expect(await loadsOf(app, nextTrack!.id)).toBe(1);
    expect(await loadsOf(app, nextRelease.id)).toBe(1);
  },
);

test(
  "TRI-26 a pasted YouTube link is attached and plays, on its track or under Other videos",
  { tag: ["@TRI-26", "@P1"] },
  async ({ app, fakes }) => {
    const triage = new TriagePage(app);
    const { lowTide, liveSet } = YOUTUBE_ONLY;
    const withoutVideo = FIRST_RECORD.tracks.find((track) => track.title === "Low Tide")!;
    const attachRequest = `POST /api/releases/${FIRST_RECORD.id}/videos`;
    await app.open();
    await triage.startListening();

    await app.paste("Nautic Unit - Low Tide, heard on Kool FM");
    await triage.openNote();
    await app.paste(youtubeWatchUrl(lowTide.id));
    await triage.cancelNote();
    await triage.attachVideo(youtubeWatchUrl(lowTide.id));
    // The pastes before were sent first, had they sent anything.
    expect(app.apiRequests().filter((request) => request === attachRequest)).toHaveLength(1);
    await expect(triage.currentTrack).toHaveAttribute("data-position", withoutVideo.position);
    await expect(triage.playerStatus("playing")).toBeVisible();
    expect(await app.youtube.audible()).toBe(lowTide.id);

    await triage.attachVideo(youtubeWatchUrl(liveSet.id));
    await expect(triage.otherVideo(liveSet.id)).toContainText(liveSet.title);
    await expect(triage.otherVideo(liveSet.id).getByRole("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect.poll(() => app.youtube.audible()).toBe(liveSet.id);

    const titleLookups = fakes.log.filter((request) => request.service === "youtube");
    expect(titleLookups.map((request) => request.query.url)).toEqual([
      youtubeWatchUrl(lowTide.id),
      youtubeWatchUrl(liveSet.id),
    ]);
    const detail = await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`);
    expect(detail.videos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ videoId: lowTide.id, matchedPosition: withoutVideo.position }),
        expect.objectContaining({ videoId: liveSet.id, matchedPosition: null }),
      ]),
    );
  },
);

test.describe("with the clock", () => {
  test.use({ diggaOptions: { clock: true } });

  test(
    "TRI-03 Space pauses and resumes, the arrows seek by the seek step, 1 to 9 jump, the slider follows",
    { tag: ["@TRI-03", "@P1"] },
    async ({ app }) => {
      const { player } = await app.api.get<Config>("/api/settings");
      const triage = new TriagePage(app);
      const video = FIRST_RECORD.videos[0]!;
      const startAt = startSeconds(video.seconds, player.startAtFraction)!;
      await app.open();

      // Paused, the page's time moves only through runFor(), so the positions are exact.
      await app.clock.pause();
      await triage.startListening();
      await expectPosition(triage, startAt, video.seconds);

      await triage.pause();
      expect(await app.youtube.audible()).toBeNull();
      await app.clock.runFor(2500);
      await expectPosition(triage, startAt, video.seconds);
      await triage.resume();
      // The slider reads the player every 250 ms, so it shows the last whole second it read.
      await app.clock.runFor(2500);
      await expectPosition(triage, startAt + 2, video.seconds);
      expect(await audibleTime(app)).toBe(startAt + 2.5);

      await app.page.keyboard.press("ArrowRight");
      await expectPosition(triage, startAt + 2 + player.seekStepSeconds, video.seconds);
      expect(await audibleTime(app)).toBe(startAt + 2.5 + player.seekStepSeconds);
      await app.page.keyboard.press("ArrowLeft");
      await expectPosition(triage, startAt + 2, video.seconds);
      expect(await audibleTime(app)).toBe(startAt + 2.5);

      for (let tenth = 1; tenth <= 9; tenth += 1) {
        await app.page.keyboard.press(String(tenth));
        expect(await audibleTime(app)).toBe((video.seconds * tenth) / 10);
        await app.clock.runFor(250);
        await expectPosition(triage, (video.seconds * tenth) / 10, video.seconds);
      }
    },
  );

  test(
    "TRI-28 a video YouTube refuses while it plays is skipped with a notice",
    { tag: ["@TRI-28", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const [refused, next] = FIRST_RECORD.tracks;
      await app.open();

      // Paused, the notice stays until the test has read it.
      await app.clock.pause();
      await triage.startListening();
      await app.youtube.fail(videoOf(FIRST_RECORD, refused!.position).id, 150);

      await expect(triage.notices).toHaveText(
        `${refused!.position} ${refused!.title} won't play here: the uploader blocks embedding. Skipped.`,
      );
      await expect(triage.currentTrack).toHaveAttribute("data-position", next!.position);
      await expect(triage.playerStatus("playing")).toBeVisible();
      expect(await app.youtube.audible()).toBe(videoOf(FIRST_RECORD, next!.position).id);
      await expect(triage.track(refused!.position)).toContainText("video would not play");
      await expect(
        triage.track(refused!.position).getByText("no embed", { exact: true }),
      ).toBeVisible();
    },
  );

  test(
    "TRI-36 leaving Triage pauses the sound and logs a listen's remainder of 1 s or more; returning keeps the record and undo",
    { tag: ["@TRI-36", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      await app.open();
      const judged = await triage.currentKey();
      await expect(triage.upNext).toContainText("buffered, starts at once");

      // Paused, a listen counts exactly the time runFor() lets pass.
      await app.clock.pause();
      await triage.judge("rejected");
      const kept = await triage.currentKey();
      expect((await triage.listenFor(4500)).seconds).toBe(4);
      await header.goTo("twelves");
      await expect.poll(() => app.youtube.audible()).toBeNull();
      await header.goTo("triage");
      await expect(triage.record).toHaveAttribute("data-triage-key", kept);

      await triage.resume();
      const resumedListen = await triage.listenFor(5500);
      expect(resumedListen.seconds).toBe(4);
      const onLeaving = await triage.listenLoggedBy(() => header.goTo("twelves"));
      expect(onLeaving).toMatchObject({
        releaseId: SECOND_RECORD.id,
        position: SECOND_RECORD.tracks[0]!.position,
        videoId: SECOND_RECORD.videos[0]!.id,
        seconds: 1.5,
        heard: true,
      });
      await expect.poll(() => app.youtube.audible()).toBeNull();
      expect(onLeaving.context?.playbackId).toBe(resumedListen.context?.playbackId);
      expect(onLeaving.context?.startSeconds).toBe(resumedListen.context?.endSeconds);
      // Listens are posted in order, so the first leaving, 0.5 s past its listen, posted nothing.
      const listens = app.apiRequests().filter((request) => request === "POST /api/listen-log");
      expect(listens).toHaveLength(3);

      await header.goTo("triage");
      await expect(triage.record).toHaveAttribute("data-triage-key", kept);
      await triage.undoVerdict(judged);
      await expect(triage.record).toHaveAttribute("data-triage-key", judged);
    },
  );
});

test.describe("digging records without audio", () => {
  test.use({ diggaOptions: { labels: [ECHO_CHAMBER.name] } });

  test(
    "TRI-27 a release without videos says so and offers S, Cmd+V and D; verdict keys still work",
    { tag: ["@TRI-27", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      await app.open();
      await triage.pass();

      await expect(triage.record).toHaveAttribute("data-release-id", String(WITHOUT_VIDEOS.id));
      await expect(
        triage.player.getByText("No videos on this release.", { exact: true }),
      ).toBeVisible();
      for (const offer of [
        "S search YouTube",
        "⌘V paste a YouTube link to play it",
        "D no audio, off the queue",
        "Verdict keys still work.",
      ])
        await expect(triage.player.getByText(offer, { exact: true })).toBeVisible();
      await expect(triage.playerStatus("no_audio")).toBeVisible();
      await expect(triage.track(WITHOUT_VIDEOS.tracks[0]!.position)).toContainText("no video");

      const key = await triage.currentKey();
      await triage.judge("no_audio");
      await expect(triage.record).not.toHaveAttribute("data-triage-key", key);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toEqual([expect.objectContaining({ key, status: "no_audio" })]);
    },
  );

  test(
    "TRI-28 records whose videos are all refused say so; embed=false videos read no embed and never load",
    { tag: ["@TRI-28", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const [playable, blocked] = EMBEDDING_OFF.tracks;
      const blockedVideo = EMBEDDING_OFF.videos.find((video) => !video.embed)!;
      await app.open();
      await triage.pass();
      await triage.pass();

      await expect(triage.record).toHaveAttribute("data-release-id", String(ONLY_VIDEO_REFUSED.id));
      await expect(
        triage.player.getByText("Its only video won't play here.", { exact: true }),
      ).toBeVisible();
      await triage.pass();
      await expect(triage.record).toHaveAttribute(
        "data-release-id",
        String(EVERY_VIDEO_REFUSED.id),
      );
      const videos = EVERY_VIDEO_REFUSED.videos.length;
      await expect(
        triage.player.getByText(`None of its ${videos} videos will play here.`, { exact: true }),
      ).toBeVisible();
      await expect(triage.playerStatus("no_audio")).toBeVisible();

      await triage.pass();
      await expect(triage.record).toHaveAttribute("data-release-id", String(EMBEDDING_OFF.id));
      await expect(triage.currentTrack).toHaveAttribute("data-position", playable!.position);
      await expect(triage.playerStatus("playing")).toBeVisible();
      await expect(triage.track(blocked!.position)).toContainText("video blocks embedding");
      await expect(
        triage.track(blocked!.position).getByText("no embed", { exact: true }),
      ).toBeVisible();
      const loaded = (await app.youtube.loads()).map((load) => load.videoId);
      expect(loaded).not.toContain(blockedVideo.id);
    },
  );
});

test.describe("digging a run of tracks, with the clock", () => {
  test.use({ diggaOptions: { clock: true, labels: [GROUNDWORK.name] } });

  test(
    "TRI-04 J and K change track, skipping refused videos and, for J, heard tunes; a video's end moves on",
    { tag: ["@TRI-04", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const [a1, a2, b1, b2, b3] = TRACK_RUN.tracks.map((track) => track.position);
      for (const heard of [a2!, b3!])
        await app.given.listen({
          releaseId: TRACK_RUN.id,
          position: heard,
          videoId: videoOf(TRACK_RUN, heard).id,
          seconds: 5,
        });
      await app.open();
      for (const heard of [a2!, b3!])
        await expect(triage.track(heard).getByText("heard", { exact: true })).toBeVisible();

      await triage.startListening();
      await expect(triage.currentTrack).toHaveAttribute("data-position", a1!);
      // The hidden deck that buffers J's next track has found that YouTube refuses B1.
      await expect(triage.track(b1!)).toContainText("video would not play");
      expect(await triage.nextTrack()).toBe(b2);
      expect(await triage.previousTrack()).toBe(a2);
      expect(await triage.previousTrack()).toBe(a1);

      await app.youtube.end();
      await expect(triage.currentTrack).toHaveAttribute("data-position", b2!);
      await expect(triage.playerStatus("playing")).toBeVisible();
      expect(await app.youtube.audible()).toBe(videoOf(TRACK_RUN, b2!).id);
      // Only heard tunes are left after B2, so J falls back to one.
      expect(await triage.nextTrack()).toBe(b3);

      // Paused, the notice stays until the test has read it.
      await app.clock.pause();
      await app.page.keyboard.press("j");
      await expect(triage.notices).toHaveText("That was the last track. Judge it.");
      await expect(triage.currentTrack).toHaveAttribute("data-position", b3!);
      await app.youtube.end();
      await expect(triage.playerStatus("ended")).toBeVisible();
    },
  );

  test(
    "TRI-18 Shift+K, Shift+M and Shift+C mark the playing track, the same key clears it, and Tracks lists keep and grail",
    { tag: ["@TRI-18", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const twelves = new TwelvesPage(app);
      const [kept, meh, refused, grail] = TRACK_RUN.tracks;
      await app.open();
      await triage.startListening();

      // The mark carries the playing video and the second it had reached, past the start at half.
      const keptVideo = TRACK_RUN.videos[0]!;
      const mark = { releaseId: TRACK_RUN.id, position: kept!.position, videoId: keptVideo.id };
      const saved = await triage.markTrack("keep");
      expect(saved).toMatchObject({
        ...mark,
        mark: "keep",
        atSeconds: expect.any(Number),
        tune: { title: kept!.title },
      });
      expect(saved.atSeconds).toBeGreaterThanOrEqual(keptVideo.seconds / 2);
      await expect(triage.trackMark(kept!.position, "keep")).toBeVisible();
      expect(await triage.markTrack("keep")).toMatchObject({
        ...mark,
        mark: null,
        atSeconds: expect.any(Number),
      });
      await expect(triage.trackMark(kept!.position, "keep")).toBeHidden();
      await triage.markTrack("keep");
      expect(await triage.nextTrack()).toBe(meh!.position);
      await triage.markTrack("meh");
      await expect(triage.track(refused!.position)).toContainText("video would not play");
      expect(await triage.nextTrack()).toBe(grail!.position);
      await triage.markTrack("candidate");
      await expect(triage.trackMark(kept!.position, "keep")).toBeVisible();
      await expect(triage.trackMark(meh!.position, "meh")).toBeVisible();
      await expect(triage.trackMark(grail!.position, "candidate")).toBeVisible();

      // Passed, the only record leaves the queue, and nothing plays.
      await app.page.keyboard.press("n");
      await expect(triage.player.getByText("Nothing playing", { exact: true })).toBeVisible();
      await app.page.keyboard.press(trackMarkKey("keep"));
      await expect(triage.messages).toHaveText(
        "Track marks go on the playing track; nothing is playing.",
      );

      await new HeaderPage(app).goTo("twelves");
      await twelves.showShelf("tracks");
      await expect(twelves.row("tracks", kept!.title)).toContainText(MARK_COPY.keep);
      await expect(twelves.row("tracks", grail!.title)).toContainText(MARK_COPY.candidate);
      await expect(twelves.row("tracks", meh!.title)).toHaveCount(0);
    },
  );
});

test.describe("digging a tune that another release repeats, with the clock", () => {
  test.use({
    diggaOptions: {
      clock: true,
      labels: [FIRST_RECORD.label.name, SAME_TUNE_ELSEWHERE.label.name],
    },
  });

  test(
    "TRI-06 4 s of playback log a listen; the track then reads played, and the tune reads heard on another release; a shorter play is logged unheard",
    { tag: ["@TRI-06", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const [tune, after] = FIRST_RECORD.tracks;
      const elsewhere = SAME_TUNE_ELSEWHERE.tracks.find((track) => track.title === tune!.title)!;
      await app.open();
      await expect(triage.upNext).toContainText(SAME_TUNE_ELSEWHERE.title);

      await app.clock.pause();
      await triage.startListening();
      const listen = await triage.listenFor();
      expect(listen).toMatchObject({
        releaseId: FIRST_RECORD.id,
        position: tune!.position,
        videoId: videoOf(FIRST_RECORD, tune!.position).id,
        seconds: 4,
        heard: true,
      });
      expect(listen.context?.tune?.title).toBe(tune!.title);
      expect(listen.context?.playbackId).toBeTruthy();
      expect(listen.context!.endSeconds - listen.context!.startSeconds).toBeCloseTo(4, 0);
      expect(await triage.nextTrack()).toBe(after!.position);
      await expect(triage.track(tune!.position).getByText("played", { exact: true })).toBeVisible();

      await app.clock.runFor(2000);
      const tap = await triage.listenLoggedBy(() => triage.judge("rejected"));
      expect(tap).toMatchObject({
        releaseId: FIRST_RECORD.id,
        position: after!.position,
        videoId: videoOf(FIRST_RECORD, after!.position).id,
        seconds: 2,
        heard: false,
      });
      const judged = await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`);
      expect(judged.tracks.map((track) => track.heard)).toEqual(
        FIRST_RECORD.tracks.map((track) => track === tune),
      );
      await expect(triage.record).toHaveAttribute(
        "data-release-id",
        String(SAME_TUNE_ELSEWHERE.id),
      );
      await expect(
        triage.track(elsewhere.position).getByText("heard", { exact: true }),
      ).toBeVisible();
      const detail = await app.api.get<ReleaseDetail>(`/api/releases/${SAME_TUNE_ELSEWHERE.id}`);
      expect(detail.tracks.find((track) => track.position === elsewhere.position)?.heard).toBe(
        true,
      );
    },
  );
});

test.describe("digging a master whose repress has the only video, without videoless releases", () => {
  test.use({
    diggaOptions: {
      labels: [TRANSIT_AUDIO.name],
      config: { filters: { skipWithoutVideos: true } },
    },
  });

  test(
    "TRI-37 a main release without a video plays its repress's video on its own track, which takes the mark",
    { tag: ["@TRI-37", "@P2"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const [tune, withoutVideo] = POOLED_MAIN.tracks;
      const pooled = POOLED_REPRESS.videos[0]!;
      await app.open();

      // The record passes the filter for releases without videos on its repress's video.
      await expect(triage.record).toHaveAttribute("data-release-id", String(POOLED_MAIN.id));
      await triage.startListening();
      expect(await app.youtube.audible()).toBe(pooled.id);
      await expect(triage.currentTrack).toHaveAttribute("data-position", tune!.position);
      await expect(triage.track(withoutVideo!.position)).toContainText("no video");
      expect(await triage.markTrack("keep")).toMatchObject({
        releaseId: POOLED_MAIN.id,
        position: tune!.position,
        videoId: pooled.id,
        mark: "keep",
      });
    },
  );
});

/** The video at the track's place; the fixtures used here list their videos in track order. */
function videoOf(release: FixtureRelease, position: string) {
  const index = release.tracks.findIndex((track) => track.position === position);
  const video = release.videos[index];
  if (!video) throw new Error(`release ${release.id} has no video for ${position}`);
  return video;
}

/** The position slider's value and the time it announces. */
async function expectPosition(
  triage: TriagePage,
  seconds: number,
  durationSeconds: number,
): Promise<void> {
  await expect(triage.position).toHaveValue(String(seconds));
  await expect(triage.position).toHaveAttribute(
    "aria-valuetext",
    `${formatDuration(seconds)} of ${formatDuration(durationSeconds)}`,
  );
}

/** Where the fake player that plays with sound is, in seconds. */
async function audibleTime(app: DiggaApp): Promise<number | undefined> {
  const audible = await app.youtube.audible();
  const players = await app.youtube.players();
  return players.find((player) => player.videoId === audible && !player.muted)?.time;
}

/** How often a fake player has loaded or cued the video. */
async function loadsOf(app: DiggaApp, videoId: string): Promise<number> {
  const loads = await app.youtube.loads();
  return loads.filter((load) => load.videoId === videoId).length;
}
