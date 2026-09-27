import { describe, expect, it } from "vite-plus/test";
import type { TrackDetail } from "../src/shared/api.ts";
import {
  buildPlaylist,
  entryForPosition,
  firstEntry,
  nextEntry,
  previousEntry,
  startSeconds,
} from "../src/shared/playlist.ts";
import type { VideoRecord } from "../src/shared/types.ts";

function track(seq: number, position: string, heard = false): TrackDetail {
  return {
    releaseId: 1,
    seq,
    position,
    title: `Tune ${position}`,
    artists: [],
    artistDisplay: "Artist",
    durationSeconds: null,
    heardKey: `artist - tune ${position}`,
    heard,
    hasVideo: true,
    mark: null,
  };
}

function video(videoId: string, matchedPosition: string | null, embeddable = true): VideoRecord {
  return {
    releaseId: 1,
    videoId,
    src: `https://youtu.be/${videoId}`,
    title: videoId,
    durationSeconds: 300,
    embeddable,
    matchedPosition,
  };
}

const none = { failed: new Set<string>(), played: new Set<string>() };

describe("playlist", () => {
  const tracks = [track(0, "A1"), track(1, "A2", true), track(2, "B1"), track(3, "B2")];
  const videos = [
    video("mix", null),
    video("b1", "B1"),
    video("a2", "A2"),
    video("a1", "A1"),
    video("blocked", "B2", false),
    video("b1-again", "B1"),
  ];
  const entries = buildPlaylist({ tracks, videos });

  it("orders embeddable videos by tracklist, strays last", () => {
    expect(entries.map((e) => e.video.videoId)).toEqual(["a1", "a2", "b1", "b1-again", "mix"]);
    expect(entries.map((e) => e.heardBefore)).toEqual([false, true, false, false, false]);
    expect(entryForPosition(entries, "B1")).toBe(2);
    expect(entryForPosition(entries, "B2")).toBeNull();
  });

  it("skips heard tunes, failed videos and second uploads going forward", () => {
    expect(firstEntry(entries, none)).toBe(0);
    expect(nextEntry(entries, 0, none, { fallback: false })).toBe(2);
    const played = { failed: new Set<string>(), played: new Set(["a1", "b1"]) };
    expect(nextEntry(entries, 2, played, { fallback: false })).toBe(4);
    const failed = { failed: new Set(["b1", "mix"]), played: new Set(["a1"]) };
    expect(nextEntry(entries, 0, failed, { fallback: false })).toBe(3);
    expect(nextEntry(entries, 3, failed, { fallback: false })).toBeNull();
    expect(nextEntry(entries, 4, none, { fallback: true })).toBeNull();
  });

  it("falls back to heard tunes when nothing else is left", () => {
    const allHeard = buildPlaylist({
      tracks: [track(0, "A", true), track(1, "B", true)],
      videos: [video("a", "A"), video("b", "B")],
    });
    expect(nextEntry(allHeard, null, none, { fallback: false })).toBeNull();
    expect(firstEntry(allHeard, none)).toBe(0);
    expect(firstEntry(allHeard, { failed: new Set(["a"]), played: new Set() })).toBe(1);
    expect(firstEntry([], none)).toBeNull();
  });

  it("goes back over failed videos only", () => {
    expect(previousEntry(entries, 3, none)).toBe(2);
    expect(previousEntry(entries, 3, { failed: new Set(["b1"]), played: new Set() })).toBe(1);
    expect(previousEntry(entries, 0, none)).toBeNull();
  });

  it("starts at a fraction of the duration, clear of the end", () => {
    expect(startSeconds(372, 0.5)).toBe(186);
    expect(startSeconds(372, 1)).toBe(367);
    expect(startSeconds(3, 0.5)).toBe(0);
    expect(startSeconds(null, 0.5)).toBeNull();
    expect(startSeconds(0, 0.5)).toBeNull();
  });
});
