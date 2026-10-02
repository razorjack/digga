import { describe, expect, it } from "vite-plus/test";
import {
  defaultYearSpan,
  estimateCatalogue,
  loadYearsFor,
  middleSpan,
  checksumRetryNote,
  roundEstimate,
  stoppedDownloadMessage,
  styleGroups,
  suggestedStyles,
  togetherWith,
  yearHistogram,
} from "../src/client/setup/model.ts";
import { withChange } from "../src/client/setup/flow.svelte.ts";
import type { SeedTally } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { CensusStyle, StyleCensus } from "../src/shared/style-census.ts";
import { INTERRUPTED_JOB_ERROR, type Job } from "../src/shared/types.ts";

function style(name: string, genre: string, firstYear: number, years: number[]): CensusStyle {
  const releases = years.reduce((sum, count) => sum + count, 0);
  return {
    name,
    genre,
    releases: releases + 10,
    vinyl: Math.round(releases / 2),
    firstYear,
    years,
    vinylYears: years.map((count) => Math.round(count / 2)),
    undated: 10,
    undatedVinyl: 5,
    together: [],
  };
}

// Drum n Bass 1995–2004 with 100 a year, Jungle 1993–1998 with 50 a year, sharing 200 releases.
const dnb = { ...style("Drum n Bass", "Electronic", 1995, Array(10).fill(100)) };
const jungle = { ...style("Jungle", "Electronic", 1993, Array(6).fill(50)) };
dnb.together = [
  ["Jungle", 200],
  ["Breakbeat", 90],
];
jungle.together = [["Drum n Bass", 200]];
const house = style("House", "Electronic", 1985, Array(40).fill(1000));
const jazz = style("Hard Bop", "Jazz", 1955, Array(10).fill(30));
const CENSUS: StyleCensus = {
  dumpDate: "2026-09-01",
  releases: 50_000,
  styles: [dnb, jazz, house, jungle, style("Breakbeat", "Electronic", 1990, [5])],
};

describe("the catalogue estimate", () => {
  it("counts the load years with the undated releases, and the dug years apart", () => {
    const estimate = estimateCatalogue(CENSUS, ["Drum n Bass"], {
      span: [1998, 2002],
      vinylOnly: false,
    });

    expect(loadYearsFor([1998, 2002])).toEqual([1995, 2005]);
    expect(estimate).toEqual({ releases: 1010, dug: 500, bytes: 1010 * 1900 });
    expect(
      estimateCatalogue(CENSUS, ["Drum n Bass"], { span: [1998, 2002], vinylOnly: true }).dug,
    ).toBe(250);
  });

  it("counts releases two picks share once", () => {
    const both = estimateCatalogue(CENSUS, ["Drum n Bass", "Jungle"], {
      span: [1996, 2001],
      vinylOnly: false,
    });

    // 1010 + 310, less Jungle's 310 of 310 years' share of the 200 shared.
    expect(both.releases).toBe(1010 + 310 - Math.round((200 * 310) / 310));
  });
});

describe("the style picker", () => {
  it("groups styles by genre, largest first, and finds them by name", () => {
    expect(styleGroups(CENSUS).map((group) => group.genre)).toEqual(["Electronic", "Jazz"]);
    expect(styleGroups(CENSUS, "", ["Hard Bop"]).map((group) => group.genre)).toEqual([
      "Jazz",
      "Electronic",
    ]);
    const found = styleGroups(CENSUS, "ungl").flatMap((group) => group.styles);
    expect(found.map((match) => match.name)).toEqual(["Jungle"]);
  });

  it("suggests styles often tagged with the picks, and none it already has", () => {
    expect(togetherWith(CENSUS, ["Drum n Bass"])).toEqual(["Jungle", "Breakbeat"]);
    expect(togetherWith(CENSUS, ["Drum n Bass", "Jungle"])).toEqual(["Breakbeat"]);
  });

  it("suggests the styles most imported releases carry", () => {
    const seeds: SeedTally = {
      releases: 100,
      styles: [
        { name: "Drum n Bass", releases: 80, years: [] },
        { name: "Jungle", releases: 20, years: [] },
        { name: "Unknown Style", releases: 15, years: [] },
        { name: "House", releases: 5, years: [] },
      ],
    };
    expect(suggestedStyles(CENSUS, seeds).map((seed) => seed.name)).toEqual([
      "Drum n Bass",
      "Jungle",
    ]);
  });
});

describe("the default years", () => {
  it("take the middle 80% of the counts", () => {
    const years: [number, number][] = [
      1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999,
    ].map((year) => [year, 10]);
    expect(middleSpan(years)).toEqual([1991, 1998]);
    expect(middleSpan([])).toBeNull();
  });

  it("follow the imported releases when there are enough, else the catalogue", () => {
    const seeds: SeedTally = {
      releases: 12,
      styles: [
        {
          name: "Drum n Bass",
          releases: 12,
          years: [
            [1998, 1],
            [1999, 5],
            [2000, 5],
            [2003, 1],
          ],
        },
      ],
    };
    expect(defaultYearSpan(CENSUS, seeds, ["Drum n Bass"])).toEqual([1999, 2000]);
    expect(defaultYearSpan(CENSUS, { releases: 0, styles: [] }, ["Drum n Bass"])).toEqual([
      1996, 2003,
    ]);
    expect(yearHistogram(CENSUS, ["Jungle", "Drum n Bass"]).get(1995)).toBe(150);
  });

  it("round estimates to two figures", () => {
    expect([roundEstimate(76_412), roundEstimate(1_234), roundEstimate(87)]).toEqual([
      76_000, 1_200, 87,
    ]);
  });
});

describe("the config the setup writes", () => {
  it("digs the picks for real: styles, load years around the dug ones, filters", () => {
    const config = withChange(DEFAULT_CONFIG, {
      picks: {
        styles: ["Jungle", "Drum n Bass"],
        span: [1994, 1997],
        loadYears: [1991, 2000],
        vinylOnly: false,
      },
    });

    expect(config.sandbox).toBe(false);
    expect(config.universe).toMatchObject({
      styles: ["Jungle", "Drum n Bass"],
      loadYears: [1991, 2000],
    });
    expect(config.filters).toMatchObject({
      styles: null,
      yearFrom: 1994,
      yearTo: 1997,
      formats: [],
    });
    expect(DEFAULT_CONFIG.sandbox).toBe(true);
  });

  it("keeps the account's name and currency, and a practice round's sandbox", () => {
    const config = withChange(DEFAULT_CONFIG, { username: "dj", currency: "GBP", sandbox: true });
    expect(config.discogs).toMatchObject({ username: "dj", currency: "GBP" });
    expect(config.sandbox).toBe(true);
  });
});

describe("a download that stopped", () => {
  function download(status: Job["status"], error: string | null, receivedBytes: number): Job {
    return {
      id: "download",
      type: "dump_download",
      status,
      error,
      createdAt: "2026-10-02T10:00:00.000Z",
      startedAt: "2026-10-02T10:00:00.000Z",
      finishedAt: null,
      progress: {
        phase: "downloading",
        file: "discogs_20260901_releases.xml.gz",
        receivedBytes,
        totalBytes: 11_252_161_836,
        alreadyDownloaded: false,
      },
    } as Job;
  }

  it("says where it stopped and why, and that it starts again", () => {
    expect(stoppedDownloadMessage(download("failed", "fetch failed", 4_400_000_000))).toBe(
      "The download stopped at 4.1 GB of 10.5 GB: fetch failed. Discogs does not allow resuming, so it starts again.",
    );
  });

  it("gives only the reason when nothing had arrived", () => {
    expect(stoppedDownloadMessage(download("failed", "The dump needs 900 TB free.", 0))).toBe(
      "The download stopped: The dump needs 900 TB free.",
    );
  });

  it("says a download that did not match the checksum twice does not, and notes the second try", () => {
    const mismatched = (status: Job["status"], checksumMismatches: number) => {
      const job = download(status, "does not match its published checksum", 10);
      return { ...job, progress: { ...job.progress!, checksumMismatches } } as Job;
    };

    expect(stoppedDownloadMessage(mismatched("failed", 2))).toBe(
      "The download does not match Discogs' checksum. Digga downloaded it twice.",
    );
    expect(checksumRetryNote(mismatched("running", 1))).toBe(
      "The download does not match Discogs' checksum, so Digga downloads it once more.",
    );
    expect(checksumRetryNote(mismatched("running", 0))).toBeNull();
    expect(checksumRetryNote(mismatched("failed", 2))).toBeNull();
  });

  it("says nothing of a download that runs, finished, was cancelled or ended with Digga", () => {
    expect(stoppedDownloadMessage(null)).toBeNull();
    expect(stoppedDownloadMessage(download("running", null, 10))).toBeNull();
    expect(stoppedDownloadMessage(download("done", null, 10))).toBeNull();
    expect(stoppedDownloadMessage(download("cancelled", null, 10))).toBeNull();
    expect(stoppedDownloadMessage(download("failed", INTERRUPTED_JOB_ERROR, 10))).toBeNull();
  });
});
