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

  it("keeps the letters of every script", () => {
    expect(normalizeText("Кино – Группа крови")).toBe("кино группа крови");
    expect(normalizeText("坂本龍一")).toBe("坂本龍一");
    expect(normalizeText("ばか")).not.toBe(normalizeText("はか"));
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
  const artist = (name: string, id: number | null = 1, anv = "") => ({ id, name, anv, join: "" });
  const tune = (artists: ReturnType<typeof artist>[], title: string, position = "A1") =>
    heardKeyFor({ artists, title, recordKey: "m:501", position });

  it("is stable across releases of the same tune, also under another credited name", () => {
    expect(tune([artist("Konflict")], "Messiah")).toBe("konflict - messiah");
    expect(tune([artist("Konflict", 1, "Konflikt")], "MESSIAH ", "B2")).toBe("konflict - messiah");
    expect(tune([artist("Konflict")], "Messiah (Remix)")).not.toBe(
      tune([artist("Konflict")], "Messiah"),
    );
  });

  it("tells apart same-named artists and tunes in other scripts", () => {
    expect(tune([artist("Signal (2)", 2)], "Smile")).toBe("signal 2 - smile");
    expect(tune([artist("Signal (3)", 3)], "Smile")).toBe("signal 3 - smile");
    expect(tune([artist("東京")], "青空")).toBe("東京 - 青空");
    expect(tune([artist("大阪")], "夜")).toBe("大阪 - 夜");
  });

  it("is the record's tune at its position when nobody known made it or its title is generic", () => {
    expect(tune([artist("Unknown Artist", 355)], "Messiah")).toBe("m:501 A1");
    expect(tune([artist("Various", null)], "Messiah", "B")).toBe("m:501 B");
    expect(tune([], "Messiah")).toBe("m:501 A1");
    for (const title of ["Untitled", "Untitled 2", "Track 01", "Side B", "B2", "Dub", ""])
      expect(tune([artist("Ed Rush")], title)).toBe("m:501 A1");
    expect(tune([artist("Ed Rush")], "Untitled Dream")).toBe("ed rush - untitled dream");
    expect(tune([artist("Moby")], "Go")).toBe("moby - go");
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
