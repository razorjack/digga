import type { SeedTally } from "../../shared/api.ts";
import { formatBytes, formatEta } from "../../shared/display.ts";
import type { CensusStyle, StyleCensus } from "../../shared/style-census.ts";
import { INTERRUPTED_JOB_ERROR, type Job } from "../../shared/types.ts";

/** Years the load keeps on each side of the dug ones, so they can be widened without a load. */
export const LOAD_MARGIN_YEARS = 3;
/** Library bytes per loaded release, measured on the owner's library (136 MB, 71,699 releases). */
export const BYTES_PER_RELEASE = 1900;
/** "Start digging" waits for this many records, so the queue cannot run dry during the load. */
export const DIG_THRESHOLD = 500;

export type YearSpan = [number, number];

/** The load window for a dug span. */
export function loadYearsFor(span: YearSpan): YearSpan {
  return [span[0] - LOAD_MARGIN_YEARS, span[1] + LOAD_MARGIN_YEARS];
}

export interface CatalogueEstimate {
  /** Releases the load keeps: the picks in the load years, and those without a year. */
  releases: number;
  /** Of them, the ones in the dug years, on vinyl or in any format. */
  dug: number;
  bytes: number;
}

/**
 * About how many releases the picks bring. A release with two of the picks counts once: the
 * releases two styles share are taken off, in proportion to the part of the smaller style that
 * falls in the years. Only pairs are counted, so three or more overlapping picks come out a
 * little low.
 */
export function estimateCatalogue(
  census: StyleCensus,
  picks: string[],
  dug: { span: YearSpan; vinylOnly: boolean; loadYears?: YearSpan },
): CatalogueEstimate {
  const styles = pickedStyles(census, picks);
  const load = dug.loadYears ?? loadYearsFor(dug.span);
  const kept = (style: CensusStyle) => countIn(style, load, false) + style.undated;
  const releases = withoutShared(styles, kept);
  const dugReleases = withoutShared(styles, (style) => countIn(style, dug.span, dug.vinylOnly));
  return { releases, dug: dugReleases, bytes: releases * BYTES_PER_RELEASE };
}

function withoutShared(styles: CensusStyle[], count: (style: CensusStyle) => number): number {
  const counts = styles.map(count);
  let total = counts.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < styles.length; index += 1) {
    for (let other = index + 1; other < styles.length; other += 1) {
      const smaller = counts[index]! <= counts[other]! ? index : other;
      const share = counts[smaller]! / Math.max(1, styles[smaller]!.releases);
      total -= sharedReleases(styles[index]!, styles[other]!) * share;
    }
  }
  return Math.max(Math.round(total), ...counts, 0);
}

function sharedReleases(style: CensusStyle, other: CensusStyle): number {
  const fromStyle = style.together.find(([name]) => name === other.name)?.[1];
  const fromOther = other.together.find(([name]) => name === style.name)?.[1];
  return fromStyle ?? fromOther ?? 0;
}

/** The style's releases in the span, or its vinyl ones. */
function countIn(style: CensusStyle, span: YearSpan, vinylOnly: boolean): number {
  if (style.firstYear === null) return 0;
  const counts = vinylOnly ? style.vinylYears : style.years;
  let total = 0;
  for (let year = Math.max(span[0], style.firstYear); year <= span[1]; year += 1)
    total += counts[year - style.firstYear] ?? 0;
  return total;
}

function pickedStyles(census: StyleCensus, picks: string[]): CensusStyle[] {
  return census.styles.filter((style) => picks.includes(style.name));
}

/** Releases per year for the picks, over the years any of them has; a release counts per style. */
export function yearHistogram(census: StyleCensus, picks: string[]): Map<number, number> {
  const histogram = new Map<number, number>();
  for (const style of pickedStyles(census, picks)) {
    if (style.firstYear === null) continue;
    style.years.forEach((count, index) => {
      const year = style.firstYear! + index;
      histogram.set(year, (histogram.get(year) ?? 0) + count);
    });
  }
  return new Map([...histogram].sort((left, right) => left[0] - right[0]));
}

/** The span holding the middle 80% of the counts, a tenth cut from each end; null without any. */
export function middleSpan(counts: Iterable<[number, number]>): YearSpan | null {
  const years = [...counts]
    .filter(([, count]) => count > 0)
    .sort((left, right) => left[0] - right[0]);
  const total = years.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;
  const cut = total / 10;
  return [yearAtCount(years, cut), yearAtCount(years.toReversed(), cut)];
}

function yearAtCount(years: [number, number][], skipped: number): number {
  let seen = 0;
  for (const [year, count] of years) {
    seen += count;
    if (seen > skipped) return year;
  }
  return years.at(-1)![0];
}

/**
 * The years to dig by default: where the imported releases in the picks were released, when
 * there are enough of them to say, else where most of the picks' releases were.
 */
export function defaultYearSpan(
  census: StyleCensus,
  seeds: SeedTally,
  picks: string[],
): YearSpan | null {
  const imported = new Map<number, number>();
  for (const style of seeds.styles.filter((seed) => picks.includes(seed.name)))
    for (const [year, count] of style.years) imported.set(year, (imported.get(year) ?? 0) + count);
  const importedCount = [...imported.values()].reduce((sum, count) => sum + count, 0);
  if (importedCount >= 10) return middleSpan(imported);
  return middleSpan(yearHistogram(census, picks));
}

/** The styles the imported releases mostly carry: at most three, each on a tenth of them. */
export function suggestedStyles(census: StyleCensus, seeds: SeedTally): SeedTally["styles"] {
  const known = new Set(census.styles.map((style) => style.name));
  return seeds.styles
    .filter((style) => known.has(style.name) && style.releases >= seeds.releases / 10)
    .slice(0, 3);
}

/**
 * Styles often on the same releases as the picks, most shared first: at most four, each on a
 * twentieth of a pick's releases.
 */
export function togetherWith(census: StyleCensus, picks: string[]): string[] {
  const shares = new Map<string, number>();
  for (const style of pickedStyles(census, picks)) {
    for (const [name, shared] of style.together) {
      const share = shared / Math.max(1, style.releases);
      if (picks.includes(name) || share < 0.05) continue;
      shares.set(name, Math.max(shares.get(name) ?? 0, share));
    }
  }
  return [...shares]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name]) => name);
}

export interface GenreGroup {
  genre: string;
  releases: number;
  styles: CensusStyle[];
}

/**
 * The styles by genre: the genres of the picks first, then the largest, with styles by name
 * within each; with a query, only the styles whose name holds it.
 */
export function styleGroups(census: StyleCensus, query = "", picks: string[] = []): GenreGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, GenreGroup>();
  for (const style of census.styles) {
    const genre = style.genre || "Other";
    const group = groups.get(genre) ?? { genre, releases: 0, styles: [] };
    group.releases += style.releases;
    if (needle === "" || style.name.toLowerCase().includes(needle)) group.styles.push(style);
    groups.set(genre, group);
  }
  const picked = (group: GenreGroup) =>
    census.styles.some(
      (style) => picks.includes(style.name) && (style.genre || "Other") === group.genre,
    );
  return [...groups.values()]
    .filter((group) => group.styles.length > 0)
    .sort(
      (left, right) =>
        Number(picked(right)) - Number(picked(left)) || right.releases - left.releases,
    );
}

/** 76,412 -> 76,000; 1,234 -> 1,200: two significant figures, for an estimate. */
export function roundEstimate(count: number): number {
  if (count < 100) return count;
  const unit = 10 ** (Math.floor(Math.log10(count)) - 1);
  return Math.round(count / unit) * unit;
}

const DUMP_DAYS = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-09-01" -> "1 September 2026", the way the setup names a catalogue. */
export function formatDumpDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : DUMP_DAYS.format(parsed);
}

/** A folder in the home folder, written from ~ as people read it; other paths stay whole. */
export function homeRelative(folder: string): string {
  return folder.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** "~3 min left" at the pace since `startedAt`; null until there is enough to go on. */
export function transferLeft(
  done: number,
  total: number,
  startedAt: string,
  now: number = Date.now(),
): string | null {
  const fraction = done / total;
  const seconds = (now - Date.parse(startedAt)) / 1000;
  if (fraction < 0.01 || fraction >= 1 || seconds < 10) return null;
  return `${formatEta((seconds * (1 - fraction)) / fraction / 3600)} left`;
}

/** About how long reading a collection or wantlist takes: 100 a page, a request a second. */
export function importSeconds(items: number): number {
  return Math.max(1, Math.ceil(items / 100)) * 1.1;
}

/**
 * What the setup says of a download that stopped, or null for one that runs, finished or was
 * cancelled. A download Digga's closing interrupted is the load's to pick up, so it says nothing.
 */
export function stoppedDownloadMessage(download: Job | null): string | null {
  if (download?.type !== "dump_download" || download.status !== "failed") return null;
  if (download.error === INTERRUPTED_JOB_ERROR) return null;
  if ((download.progress?.checksumMismatches ?? 0) > 0)
    return "The download does not match Discogs' checksum. Digga downloaded it twice.";
  const reason = (download.error ?? "no reason given").replace(/\.$/, "");
  const received = download.progress?.receivedBytes ?? 0;
  if (received === 0) return `The download stopped: ${reason}.`;
  const total = download.progress?.totalBytes;
  const of = total ? ` of ${formatBytes(total)}` : "";
  return (
    `The download stopped at ${formatBytes(received)}${of}: ${reason}. ` +
    "Discogs does not allow resuming, so it starts again."
  );
}

/**
 * What the crate says of a load that stopped: one Digga's closing interrupted, or its reason. A
 * cancelled load, such as one Digga's quit stopped, has none, whatever error the job recorded.
 */
export function stoppedLoadMessage(load: Job | null): string {
  if (load?.error === INTERRUPTED_JOB_ERROR)
    return "The catalogue stopped loading when Digga closed.";
  if (!load?.error || load.status === "cancelled") return "The catalogue stopped loading.";
  return `The catalogue stopped loading: ${load.error.replace(/\.$/, "")}.`;
}

/** While the download runs again because the first did not match Discogs' checksum. */
export function checksumRetryNote(download: Job | null): string | null {
  if (download?.type !== "dump_download") return null;
  if (download.status !== "running" && download.status !== "queued") return null;
  if ((download.progress?.checksumMismatches ?? 0) === 0) return null;
  return "The download does not match Discogs' checksum, so Digga downloads it once more.";
}

/** A load that finished without keeping a release: nothing in the catalogue matches the picks. */
export function keptNothing(load: Job | null): boolean {
  if (load?.type !== "dump_load" || load.status !== "done" || !load.progress) return false;
  return load.progress.matched + load.progress.coverage === 0;
}
