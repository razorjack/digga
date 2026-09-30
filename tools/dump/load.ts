import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import zlib from "node:zlib";
import type { Db } from "../../src/server/db/db.ts";
import { writeReleases } from "../../src/server/db/releases.ts";
import type { Logger } from "../../src/server/logger.ts";
import { artistDisplay, yearFromReleased } from "../../src/shared/normalize.ts";
import { type DumpLoadProgress, type KeptRelease, UNDATED_YEAR } from "../../src/shared/types.ts";
import type { StyleCensusTally } from "./census.ts";
import { type GrowingFile, openGrowingInput } from "./growing.ts";
import { dumpReleaseToWrite } from "./convert.ts";
import { CoverageTracker } from "./coverage.ts";
import { iterateReleases } from "./parse.ts";
import type { DumpRelease } from "./types.ts";

export interface UniverseCriteria {
  /** Exact Discogs style strings; a release matches when any of its styles is listed. */
  styles: string[];
  /** Wide load window; releases without a year always pass so they can be triaged later. */
  loadYears: [number, number] | null;
  /**
   * The coverage pass: releases in other styles on these labels or by these artists are kept too,
   * when enough of the label's or artist's releases carry a style (tools/dump/coverage.ts).
   */
  labelIds?: number[];
  artistIds?: number[];
}

export interface DumpLoadOptions extends UniverseCriteria {
  /** Path to a .xml.gz or .xml file, or "-" for XML on stdin (already decompressed). */
  file: string;
  /** Stop after this many matches (development aid). */
  limit?: number;
  dryRun?: boolean;
  /** Emit and log progress every N scanned releases. */
  progressEvery?: number;
  /**
   * Also emit progress at least this often, unlogged, so a progress bar moves smoothly and a
   * stalled input still shows what has arrived.
   */
  progressEveryMs?: number;
  /** Rows per write transaction; a progress report commits a smaller batch first. */
  batchSize?: number;
  /** The dump_loads row of this load; releases it brings into the universe carry it. */
  loadId?: number;
}

export interface DumpLoadResult {
  scanned: number;
  /** Releases in the styles. */
  matched: number;
  /** Releases in other styles kept by the coverage pass. */
  coverage: number;
  upserted: number;
  elapsedSeconds: number;
  dumpDate: string | null;
  dryRun: boolean;
  /** A limit ended the load before the end of the dump. */
  stoppedAtLimit: boolean;
}

/** In the load years and in one of the styles. */
export function matchesUniverse(release: DumpRelease, criteria: UniverseCriteria): boolean {
  return hasUniverseStyle(release, criteria.styles) && inLoadYears(release, criteria.loadYears);
}

function hasUniverseStyle(release: DumpRelease, styles: string[]): boolean {
  return release.styles.some((style) => styles.includes(style));
}

/** Releases without a year always pass, so they can be triaged later. */
function inLoadYears(release: DumpRelease, loadYears: [number, number] | null): boolean {
  if (!loadYears) return true;
  const year = yearFromReleased(release.released);
  return year === null || (year >= loadYears[0] && year <= loadYears[1]);
}

/** discogs_20250901_releases.xml.gz -> 2025-09-01 */
export function dumpDateFromFilename(file: string): string | null {
  const match = /(\d{4})(\d{2})(\d{2})/.exec(path.basename(file));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** One id per line; blank lines and # comments ignored. */
export function readIdList(file: string): number[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => Number.parseInt(l, 10))
    .filter((n) => !Number.isNaN(n));
}

export interface DumpInput {
  stream: Readable;
  /** Bytes of the file read so far, as stored (compressed); null for stdin. */
  bytesRead(): number | null;
  /** The file's size as stored; null for stdin, and while a download does not know it yet. */
  totalBytes(): number | null;
}

/**
 * The dump's releases as a stream of XML. A dump that is still downloading, `growing`, is read as
 * it arrives; one already whole is read as a file.
 */
export function openDumpInput(file: string, stdin: Readable, growing?: GrowingFile): DumpInput {
  if (file === "-") return { stream: stdin, bytesRead: () => null, totalBytes: () => null };
  if (growing && !fs.existsSync(file)) return openGrowingInput(file, growing);
  const raw = fs.createReadStream(file);
  const size = fs.statSync(file).size;
  const input = { bytesRead: () => raw.bytesRead, totalBytes: () => size };
  if (!file.endsWith(".gz")) return { stream: raw, ...input };
  const gunzip = zlib.createGunzip();
  pipeline(raw, gunzip, () => {});
  return { stream: gunzip, ...input };
}

interface DumpLoadHooks {
  onProgress?: (progress: DumpLoadProgress) => void;
  logger?: Logger;
  stdin?: Readable;
  /** Counts every release of the dump, for the style census. */
  census?: StyleCensusTally;
  /** The download writing the dump, when the load starts before it ends. */
  growing?: GrowingFile;
}

function reportProgress(progress: DumpLoadProgress, hooks: DumpLoadHooks, log: boolean): void {
  hooks.onProgress?.(progress);
  if (!log) return;
  const { phase, scanned, matched, coverage, upserted, elapsedSeconds } = progress;
  hooks.logger?.info(
    `${phase}: scanned=${scanned} matched=${matched} coverage=${coverage} upserted=${upserted} ${elapsedSeconds.toFixed(0)}s`,
  );
}

/**
 * Streams the dump, keeps the releases matching the universe criteria and upserts
 * them with their tracks and videos, then the releases the coverage pass keeps. Safe to
 * run in a worker thread: it only needs a Db it owns and serialisable options.
 */
export async function loadDump(
  db: Db,
  options: DumpLoadOptions,
  hooks: DumpLoadHooks = {},
): Promise<DumpLoadResult> {
  const scan: Scan = {
    options,
    input: openDumpInput(options.file, hooks.stdin ?? (process.stdin as Readable), hooks.growing),
    started: Date.now(),
    coverage: new CoverageTracker(options),
    writer: new BatchWriter(db, options),
    counts: { scanned: 0, matched: 0, coverage: 0 },
    kept: new KeptReleases(),
    census: hooks.census,
  };
  const report = (phase: DumpLoadProgress["phase"], log: boolean) =>
    reportProgress(progressOf(scan, phase), hooks, log);
  // What the progress reports is in the database, so the setup's counts agree with it.
  const commitAndReport = (log: boolean) => {
    scan.writer.flush();
    report("scanning", log);
  };

  let stoppedAtLimit: boolean;
  const schedule = new ProgressSchedule(options, commitAndReport, (error) =>
    scan.input.stream.destroy(error),
  );
  try {
    stoppedAtLimit = await scanReleases(scan, schedule);
  } finally {
    schedule.stop();
    scan.input.stream.destroy();
  }
  // Shares need the whole dump; a load stopped by its limit keeps no coverage releases.
  if (!stoppedAtLimit)
    scan.counts.coverage = keepCoverage(scan.coverage, scan.writer, hooks.logger);
  scan.writer.flush();
  report("done", true);
  return {
    ...scan.counts,
    upserted: scan.writer.upserted,
    elapsedSeconds: elapsedSeconds(scan),
    dumpDate: dumpDateFromFilename(options.file),
    dryRun: options.dryRun ?? false,
    stoppedAtLimit,
  };
}

/** One load's state while it reads the dump. */
interface Scan {
  options: DumpLoadOptions;
  input: DumpInput;
  started: number;
  coverage: CoverageTracker;
  writer: BatchWriter;
  counts: { scanned: number; matched: number; coverage: number };
  kept: KeptReleases;
  census: StyleCensusTally | undefined;
}

/**
 * Reads the dump, writing the releases in the styles and handing the others to the coverage
 * pass. True when it stopped at the limit before the end of the dump.
 */
async function scanReleases(scan: Scan, schedule: ProgressSchedule): Promise<boolean> {
  const { options, coverage, writer, counts, kept, census } = scan;
  for await (const release of iterateReleases(scan.input.stream)) {
    counts.scanned += 1;
    census?.count(release);
    schedule.tick(counts.scanned);
    if (!admitRelease(release, options, coverage)) continue;
    counts.matched += 1;
    kept.add(release);
    writer.add(release);
    if (options.limit !== undefined && counts.matched >= options.limit) return true;
  }
  return false;
}

function progressOf(scan: Scan, phase: DumpLoadProgress["phase"]): DumpLoadProgress {
  return {
    ...scan.counts,
    upserted: scan.writer.upserted,
    phase,
    elapsedSeconds: elapsedSeconds(scan),
    bytesRead: scan.input.bytesRead(),
    totalBytes: scan.input.totalBytes(),
    added: null,
    missing: null,
    latest: scan.kept.latest,
    keptByYear: { ...scan.kept.byYear },
  };
}

function elapsedSeconds(scan: Scan): number {
  return (Date.now() - scan.started) / 1000;
}

/**
 * True for a release in the load years and the styles; one in the load years and another style
 * goes to the coverage pass instead, which counts both towards the shares of their labels.
 */
function admitRelease(
  release: DumpRelease,
  criteria: UniverseCriteria,
  coverage: CoverageTracker,
): boolean {
  const styled = hasUniverseStyle(release, criteria.styles);
  if (!styled && !coverage.active) return false;
  if (!inLoadYears(release, criteria.loadYears)) return false;
  if (styled) coverage.countStyleRelease(release);
  else coverage.offerOtherRelease(release);
  return styled;
}

/** Writes the releases the coverage pass keeps and logs the labels and artists it left out. */
function keepCoverage(coverage: CoverageTracker, writer: BatchWriter, logger?: Logger): number {
  if (!coverage.active) return 0;
  const outcome = coverage.finish();
  for (const release of outcome.releases) writer.add(release);
  if (outcome.broad.length > 0)
    logger?.info(
      `coverage left out ${outcome.broad.length} labels and artists that mostly release other styles: ${outcome.broad.join(", ")}`,
    );
  return outcome.releases.length;
}

/**
 * Reports every `progressEvery` releases, logged, and whenever `progressEveryMs` passes without a
 * report, unlogged. A timer makes the second kind, so it comes while the input stalls too, such as
 * a download that has not sent more; each report restarts it.
 */
class ProgressSchedule {
  #every: number;
  #report: (log: boolean) => void;
  #timer: NodeJS.Timeout;

  /** `fail` hears of a timed report that threw, which runs outside the scan's loop. */
  constructor(
    options: Pick<DumpLoadOptions, "progressEvery" | "progressEveryMs">,
    report: (log: boolean) => void,
    fail: (error: Error) => void,
  ) {
    this.#every = options.progressEvery ?? 100_000;
    this.#report = report;
    this.#timer = setTimeout(() => {
      try {
        this.#send(false);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }, options.progressEveryMs ?? 1000);
  }

  tick(scanned: number): void {
    if (scanned % this.#every === 0) this.#send(true);
  }

  stop(): void {
    clearTimeout(this.#timer);
  }

  #send(log: boolean): void {
    this.#report(log);
    this.#timer.refresh();
  }
}

/** The releases in the styles so far, per year, and the last of them, for the progress. */
class KeptReleases {
  byYear: Record<string, number> = {};
  latest: KeptRelease | null = null;

  add(release: DumpRelease): void {
    const year = yearFromReleased(release.released);
    const key = year === null ? UNDATED_YEAR : String(year);
    this.byYear[key] = (this.byYear[key] ?? 0) + 1;
    const label = release.labels[0];
    this.latest = {
      id: release.id,
      artist: artistDisplay(release.artists),
      title: release.title,
      label: label?.name ?? null,
      catno: label && label.catno !== "" ? label.catno : null,
      year,
    };
  }
}

/** Writes releases in batches, one transaction each; a dry run writes nothing. */
class BatchWriter {
  upserted = 0;
  #db: Db;
  #batch: DumpRelease[] = [];
  #batchSize: number;
  #dryRun: boolean;
  #loadId: number | undefined;

  constructor(db: Db, options: Pick<DumpLoadOptions, "batchSize" | "dryRun" | "loadId">) {
    this.#db = db;
    this.#batchSize = options.batchSize ?? 500;
    this.#dryRun = options.dryRun ?? false;
    this.#loadId = options.loadId;
  }

  add(release: DumpRelease): void {
    this.#batch.push(release);
    if (this.#batch.length >= this.#batchSize) this.flush();
  }

  flush(): void {
    if (this.#batch.length === 0) return;
    if (!this.#dryRun) {
      writeReleases(this.#db, this.#batch.map(dumpReleaseToWrite), { loadId: this.#loadId });
      this.upserted += this.#batch.length;
    }
    this.#batch = [];
  }
}
