import { describe, expect, it } from "vite-plus/test";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import type { VideoRecord } from "../src/shared/types.ts";
import { poolVideos } from "../src/shared/videos.ts";
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
});
