import { describe, expect, it } from "vite-plus/test";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import type { VideoRecord } from "../src/shared/types.ts";
import { hasVideoOfLink, poolVideos } from "../src/shared/videos.ts";
import { fixtureDb } from "./helpers.ts";

const video = (
  releaseId: number,
  videoId: string,
  matchedPosition: string | null,
): VideoRecord => ({
  releaseId,
  videoId,
  src: `https://youtu.be/${videoId}`,
  title: videoId,
  durationSeconds: 300,
  embeddable: true,
  matchedPosition,
});

describe("videos of other pressings", () => {
  const tracks = [
    { position: "A", heardKey: "artist - one" },
    { position: "B", heardKey: "artist - two" },
  ];

  it("adds videos for this release's tunes, at this release's positions", () => {
    const own = [video(1, "own-a", "A")];
    const pooled = poolVideos(tracks, own, [
      { video: video(2, "cd-two", "2"), heardKey: "artist - two" },
      { video: video(2, "own-a", "1"), heardKey: "artist - one" },
      { video: video(2, "cd-bonus", "3"), heardKey: "artist - bonus" },
      { video: video(3, "side-rip", null), heardKey: null },
    ]);
    expect(pooled.map((entry) => [entry.releaseId, entry.videoId, entry.matchedPosition])).toEqual([
      [1, "own-a", "A"],
      [2, "cd-two", "B"],
    ]);
  });

  it("gives a repress without videos the original's", async () => {
    const db = await fixtureDb();
    const detail = buildReleaseDetail(db, 1002)!;
    expect(detail.videos.map((entry) => [entry.videoId, entry.matchedPosition])).toEqual([
      ["aaaaaaaaaa1", "A1"],
      ["aaaaaaaaaa2", "B1"],
    ]);
    expect(detail.tracks.map((track) => track.hasVideo)).toEqual([true, true]);
    expect(buildReleaseDetail(db, 1001)!.videos).toHaveLength(2);
    db.close();
  });

  it("shares The Light Rmx with The Light (Remix) without merging other versions or artists", () => {
    const artist = "d region feat sketch and dj code";
    const pooled = poolVideos(
      [{ position: "B", heardKey: `${artist} - the light remix` }],
      [],
      [
        { video: video(132518, "Yt1RF97zDuU", "B"), heardKey: `${artist} - the light rmx` },
        { video: video(2, "original", "A"), heardKey: `${artist} - the light` },
        { video: video(3, "named-remix", "B"), heardKey: `${artist} - the light vip remix` },
        { video: video(4, "other-artist", "B"), heardKey: "other artist - the light remix" },
        { video: video(5, "unmatched", null), heardKey: null },
      ],
    );
    expect(pooled.map((entry) => [entry.videoId, entry.matchedPosition])).toEqual([
      ["Yt1RF97zDuU", "B"],
    ]);
    expect(
      poolVideos(
        [{ position: "2", heardKey: `${artist} - the light rmx` }],
        [],
        [{ video: video(4905752, "YUHPgtv-JMA", "B"), heardKey: `${artist} - the light remix` }],
      )[0]?.matchedPosition,
    ).toBe("2");
    expect(
      poolVideos(
        [{ position: "A", heardKey: "rmx - the light" }],
        [],
        [{ video: video(6, "artist-name", "A"), heardKey: "remix - the light" }],
      ),
    ).toEqual([]);
  });
});

describe("hasVideoOfLink", () => {
  it("finds the video a link points at, in any of YouTube's link shapes", () => {
    const videos = [{ videoId: "dQw4w9WgXcQ" }];
    expect(hasVideoOfLink(videos, "https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(hasVideoOfLink(videos, "https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(hasVideoOfLink(videos, "https://youtu.be/aaaaaaaaaaa")).toBe(false);
    expect(hasVideoOfLink(videos, "not a link")).toBe(false);
  });
});
