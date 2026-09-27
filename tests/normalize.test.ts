import { describe, expect, it } from "vite-plus/test";
import {
  artistDisplay,
  durationToSeconds,
  heardKeyFor,
  normalizeText,
  stripDisambiguation,
  yearFromReleased,
} from "../src/shared/normalize.ts";

describe("normalizeText", () => {
  it("lowercases, strips diacritics and punctuation", () => {
    expect(normalizeText("  Ed Rush & Optical – Wormhole (Remix)!  ")).toBe(
      "ed rush and optical wormhole remix",
    );
    expect(normalizeText("Björk")).toBe("bjork");
    expect(normalizeText("")).toBe("");
  });
});

describe("stripDisambiguation", () => {
  it("removes Discogs (n) suffixes only", () => {
    expect(stripDisambiguation("Dom & Roland (2)")).toBe("Dom & Roland");
    expect(stripDisambiguation("Konflict")).toBe("Konflict");
    expect(stripDisambiguation("Blame (Remix)")).toBe("Blame (Remix)");
  });
});

describe("artistDisplay", () => {
  it("joins names with Discogs join phrases and prefers anv", () => {
    const display = artistDisplay([
      { id: 1, name: "Ed Rush (2)", anv: "", join: "&" },
      { id: 2, name: "Optical", anv: "", join: "Feat." },
      { id: 3, name: "Ryme Tyme", anv: "Ryme Time", join: "" },
    ]);
    expect(display).toBe("Ed Rush & Optical Feat. Ryme Time");
  });
  it("uses commas without leading space", () => {
    expect(
      artistDisplay([
        { id: 1, name: "A", anv: "", join: "," },
        { id: 2, name: "B", anv: "", join: "" },
      ]),
    ).toBe("A, B");
  });
  it("handles a single artist", () => {
    expect(artistDisplay([{ id: 1, name: "Konflict", anv: "", join: "" }])).toBe("Konflict");
  });
});

describe("heardKeyFor", () => {
  it("is stable across releases of the same tune", () => {
    expect(heardKeyFor("Konflict", "Messiah")).toBe("konflict - messiah");
    expect(heardKeyFor("Konflict (2)", "MESSIAH ")).toBe("konflict - messiah");
    expect(heardKeyFor("Konflict", "Messiah (Remix)")).not.toBe(heardKeyFor("Konflict", "Messiah"));
  });
});

describe("yearFromReleased", () => {
  it("parses the Discogs date variants", () => {
    expect(yearFromReleased("2001")).toBe(2001);
    expect(yearFromReleased("2001-00-00")).toBe(2001);
    expect(yearFromReleased("1999-11-08")).toBe(1999);
    expect(yearFromReleased("")).toBeNull();
    expect(yearFromReleased(null)).toBeNull();
    expect(yearFromReleased("0")).toBeNull();
    expect(yearFromReleased("0000-00-00")).toBeNull();
  });
});

describe("durationToSeconds", () => {
  it("parses mm:ss, h:mm:ss and bare seconds", () => {
    expect(durationToSeconds("6:12")).toBe(372);
    expect(durationToSeconds("1:02:03")).toBe(3723);
    expect(durationToSeconds("83")).toBe(83);
    expect(durationToSeconds("")).toBeNull();
    expect(durationToSeconds("abc")).toBeNull();
  });
});
