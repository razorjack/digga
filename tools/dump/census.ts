import type { Readable } from "node:stream";
import type { Logger } from "../../src/server/logger.ts";
import { isVinyl } from "../../src/shared/formats.ts";
import { yearFromReleased } from "../../src/shared/normalize.ts";
import type { CensusStyle, StyleCensus } from "../../src/shared/style-census.ts";
import { dumpDateFromFilename, openDumpInput } from "./load.ts";
import { iterateReleases } from "./parse.ts";
import type { DumpRelease } from "./types.ts";

/** Styles kept per style as the ones most often on the same releases. */
const TOGETHER_KEPT = 8;
const LOG_EVERY = 1_000_000;

interface StyleTally {
  releases: number;
  vinyl: number;
  /** Year -> [releases, vinyl]. */
  years: Map<number, [number, number]>;
  undated: number;
  undatedVinyl: number;
  genres: Map<string, number>;
  together: Map<string, number>;
}

/** Counts the style census of a dump as its releases stream by; see StyleCensus. */
export class StyleCensusTally {
  #releases = 0;
  #styles = new Map<string, StyleTally>();

  count(release: DumpRelease): void {
    this.#releases += 1;
    const styles = [...new Set(release.styles)];
    if (styles.length === 0) return;
    const year = yearFromReleased(release.released);
    const vinyl = isVinyl(release.formats);
    for (const style of styles) {
      const tally = this.#tally(style);
      countRelease(tally, year, vinyl);
      for (const genre of release.genres) increment(tally.genres, genre);
      for (const other of styles) if (other !== style) increment(tally.together, other);
    }
  }

  finish(dumpDate: string | null): StyleCensus {
    const styles = [...this.#styles]
      .map(([name, tally]) => censusStyle(name, tally))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    return { dumpDate, releases: this.#releases, styles };
  }

  #tally(style: string): StyleTally {
    let tally = this.#styles.get(style);
    if (!tally) {
      tally = {
        releases: 0,
        vinyl: 0,
        years: new Map(),
        undated: 0,
        undatedVinyl: 0,
        genres: new Map(),
        together: new Map(),
      };
      this.#styles.set(style, tally);
    }
    return tally;
  }
}

/** Reads a whole dump for its census only, writing nothing (`digga dump census`). */
export async function countStyleCensus(
  file: string,
  hooks: { logger?: Logger; stdin?: Readable } = {},
): Promise<StyleCensus> {
  const tally = new StyleCensusTally();
  const input = openDumpInput(file, hooks.stdin ?? (process.stdin as Readable));
  let scanned = 0;
  try {
    for await (const release of iterateReleases(input.stream)) {
      tally.count(release);
      scanned += 1;
      if (scanned % LOG_EVERY === 0) hooks.logger?.info(`census: ${scanned} releases counted`);
    }
  } finally {
    input.stream.destroy();
  }
  return tally.finish(dumpDateFromFilename(file));
}

function countRelease(tally: StyleTally, year: number | null, vinyl: boolean): void {
  const vinylCount = vinyl ? 1 : 0;
  tally.releases += 1;
  tally.vinyl += vinylCount;
  if (year === null) {
    tally.undated += 1;
    tally.undatedVinyl += vinylCount;
    return;
  }
  const counts = tally.years.get(year) ?? [0, 0];
  counts[0] += 1;
  counts[1] += vinylCount;
  tally.years.set(year, counts);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function censusStyle(name: string, tally: StyleTally): CensusStyle {
  const years = [...tally.years.keys()];
  const firstYear = years.length > 0 ? Math.min(...years) : null;
  const lastYear = years.length > 0 ? Math.max(...years) : null;
  const perYear = (index: 0 | 1) =>
    yearRange(firstYear, lastYear).map((year) => tally.years.get(year)?.[index] ?? 0);
  return {
    name,
    genre: mostCommon(tally.genres) ?? "",
    releases: tally.releases,
    vinyl: tally.vinyl,
    firstYear,
    years: perYear(0),
    vinylYears: perYear(1),
    undated: tally.undated,
    undatedVinyl: tally.undatedVinyl,
    together: [...tally.together]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
      .slice(0, TOGETHER_KEPT),
  };
}

function yearRange(first: number | null, last: number | null): number[] {
  if (first === null || last === null) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function mostCommon(counts: Map<string, number>): string | null {
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0] ?? null;
}
