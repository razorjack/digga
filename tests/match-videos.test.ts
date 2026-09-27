import { describe, expect, it } from "vite-plus/test";
import { matchVideos } from "../src/shared/match-videos.ts";

const tracks = [
  { position: "A1", title: "Messiah", artist: "Konflict" },
  { position: "A2", title: "Messiah (Noisia Remix)", artist: "Konflict" },
  { position: "B1", title: "Beckoning", artist: "Konflict" },
  { position: "", title: "Side B", artist: "" },
];

describe("matchVideos", () => {
  it("matches exact and contained titles to positions", () => {
    const r = matchVideos(tracks, [
      { title: "Konflict - Beckoning" },
      { title: "Konflict - Messiah (Noisia Remix) [Renegade Hardware]" },
      { title: "Konflict - Messiah" },
    ]);
    expect(r.map((m) => m.position)).toEqual(["B1", "A2", "A1"]);
  });

  it("returns null for videos that match nothing", () => {
    const r = matchVideos(tracks, [{ title: "Some unrelated label showreel 2003" }]);
    expect(r[0]!.position).toBeNull();
  });

  it("never assigns tracks without a position", () => {
    const r = matchVideos(tracks, [{ title: "Side B" }]);
    expect(r[0]!.position).toBeNull();
  });

  it("uses the position token in the video title as a hint", () => {
    const r = matchVideos(
      [
        { position: "A", title: "Untitled" },
        { position: "AA", title: "Untitled" },
      ],
      [{ title: "Test Press AA - Untitled" }],
    );
    expect(r[0]!.position).toBe("AA");
  });

  it("allows two uploads of the same tune when the match is near certain", () => {
    const r = matchVideos(tracks, [
      { title: "Konflict - Beckoning" },
      { title: "Konflict - Beckoning (full)" },
    ]);
    expect(r.map((m) => m.position)).toEqual(["B1", "B1"]);
  });

  it("returns one entry per video in order", () => {
    const r = matchVideos(tracks, [{ title: "x" }, { title: "Messiah" }]);
    expect(r.map((m) => m.videoIndex)).toEqual([0, 1]);
  });
});
