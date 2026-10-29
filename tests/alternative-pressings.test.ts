import { describe, expect, it } from "vite-plus/test";
import {
  eligibleAlternative,
  matchingPressing,
  type AlternativePressing,
} from "../src/shared/alternative-pressings.ts";
import { DEFAULT_CONFIG, ConfigSchema } from "../src/shared/config.ts";

const options = { whiteLabels: true, promos: true, testPressings: false };
const formats = (descriptions: string[]) => [{ name: "Vinyl", qty: 1, text: "", descriptions }];
const source: AlternativePressing = {
  id: 1,
  masterId: 50,
  title: "Record",
  artist: "Artist",
  country: "UK",
  year: 2000,
  catno: "REC1",
  formats: formats(['12"']),
  tracks: [
    {
      position: "A",
      title: "Tune (Original Mix)",
      artists: [{ id: 1, name: "Artist", anv: "", join: "" }],
    },
    {
      position: "B",
      title: "Another Tune",
      artists: [{ id: 1, name: "Artist", anv: "", join: "" }],
    },
  ],
};

describe("alternative pressing selection", () => {
  it("defaults every automatic option off, including for older configs", () => {
    expect(DEFAULT_CONFIG.discogs.alternativePressings).toEqual({
      whiteLabels: false,
      promos: false,
      testPressings: false,
    });
    expect(
      ConfigSchema.parse({ discogs: { username: "dj" } }).discogs.alternativePressings,
    ).toEqual(DEFAULT_CONFIG.discogs.alternativePressings);
  });
  it("accepts either selected tag but requires a separate opt-in for test pressings", () => {
    expect(eligibleAlternative(formats(["White Label"]), options)).toBe(true);
    expect(eligibleAlternative(formats(["Promo"]), options)).toBe(true);
    expect(eligibleAlternative(formats(["Promo", "Test Pressing"]), options)).toBe(false);
    expect(
      eligibleAlternative(formats(["Test Pressing"]), { ...options, testPressings: true }),
    ).toBe(true);
    expect(eligibleAlternative(formats(["White Label", "Unofficial Release"]), options)).toBe(
      false,
    );
    expect(eligibleAlternative([{ ...formats(["Promo"])[0]!, name: "CD" }], options)).toBe(false);
  });
  it("matches reordered tracks while retaining mix names and duplicate tracks", () => {
    expect(matchingPressing(source, { ...source, tracks: source.tracks.toReversed() })).toBe(true);
    expect(
      matchingPressing(source, {
        ...source,
        tracks: [{ ...source.tracks[0]!, title: "Tune (Remix)" }, source.tracks[1]!],
      }),
    ).toBe(false);
    expect(
      matchingPressing(source, { ...source, tracks: [source.tracks[0]!, source.tracks[0]!] }),
    ).toBe(false);
    expect(matchingPressing(source, { ...source, tracks: [source.tracks[0]!] })).toBe(false);
  });
  it("never automatically equates generic titles, anonymous credits, missing tracks or unrelated masters", () => {
    for (const title of ["Untitled", "Track 1", "Unknown", ""]) {
      const release = { ...source, tracks: [{ ...source.tracks[0]!, title }] };
      expect(matchingPressing(release, release)).toBe(false);
    }
    const anonymous = {
      ...source,
      tracks: [
        { ...source.tracks[0]!, artists: [{ id: 355, name: "Unknown Artist", anv: "", join: "" }] },
      ],
    };
    expect(matchingPressing(anonymous, anonymous)).toBe(false);
    expect(matchingPressing({ ...source, tracks: [] }, { ...source, tracks: [] })).toBe(false);
    expect(matchingPressing(source, { ...source, masterId: 51 })).toBe(false);
    expect(matchingPressing({ ...source, masterId: null }, { ...source, masterId: null })).toBe(
      false,
    );
  });
});
