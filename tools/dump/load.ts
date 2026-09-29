import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream";
import zlib from "node:zlib";
import type { Db } from "../../src/server/db/db.ts";
import { writeReleases } from "../../src/server/db/releases.ts";
import type { Logger } from "../../src/server/logger.ts";
import { yearFromReleased } from "../../src/shared/normalize.ts";
import type { DumpLoadProgress } from "../../src/shared/types.ts";
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
  /** Emit progress every N scanned releases. */
  progressEvery?: number;
  /** Rows per write transaction. */
  batchSize?: number;
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
  /** The file's size as stored; null for stdin. */
  totalBytes: number | null;
}

export function openDumpInput(file: string, stdin: Readable): DumpInput {
  if (file === "-") return { stream: stdin, bytesRead: () => null, totalBytes: null };
  const raw = fs.createReadStream(file);
  const totalBytes = fs.statSync(file).size;
  const bytesRead = () => raw.bytesRead;
  if (!file.endsWith(".gz")) return { stream: raw, bytesRead, totalBytes };
  const gunzip = zlib.createGunzip();
  pipeline(raw, gunzip, () => {});
  return { stream: gunzip, bytesRead, totalBytes };
}

interface DumpLoadHooks {
  onProgress?: (progress: DumpLoadProgress) => void;
  logger?: Logger;
  stdin?: Readable;
}

function reportProgress(progress: DumpLoadProgress, hooks: DumpLoadHooks): void {
  hooks.onProgress?.(progress);
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
  const started = Date.now();
  const dryRun = options.dryRun ?? false;
  const writer = new BatchWriter(db, { batchSize: options.batchSize ?? 500, dryRun });
  const coverage = new CoverageTracker({
    labelIds: options.labelIds ?? [],
    artistIds: options.artistIds ?? [],
  });
  const counts = { scanned: 0, matched: 0, coverage: 0 };
  const elapsed = () => (Date.now() - started) / 1000;
  const input = openDumpInput(options.file, hooks.stdin ?? (process.stdin as Readable));
  const report = (phase: DumpLoadProgress["phase"]) =>
    reportProgress(
      {
        ...counts,
        upserted: writer.upserted,
        phase,
        elapsedSeconds: elapsed(),
        bytesRead: input.bytesRead(),
        totalBytes: input.totalBytes,
      },
      hooks,
    );

  let stoppedAtLimit: boolean;
  try {
    stoppedAtLimit = await scanReleases(input.stream, {
      options,
      coverage,
      writer,
      counts,
      report,
    });
  } finally {
    input.stream.destroy();
  }
  // Shares need the whole dump; a load stopped by its limit keeps no coverage releases.
  if (!stoppedAtLimit) counts.coverage = keepCoverage(coverage, writer, hooks.logger);
  writer.flush();
  report("done");
  return {
    ...counts,
    upserted: writer.upserted,
    elapsedSeconds: elapsed(),
    dumpDate: dumpDateFromFilename(options.file),
    dryRun,
  };
}

interface Scan {
  options: DumpLoadOptions;
  coverage: CoverageTracker;
  writer: BatchWriter;
  counts: { scanned: number; matched: number };
  report: (phase: DumpLoadProgress["phase"]) => void;
}

/**
 * Reads the dump, writing the releases in the styles and handing the others to the coverage
 * pass. True when it stopped at the limit before the end of the dump.
 */
async function scanReleases(stream: Readable, scan: Scan): Promise<boolean> {
  const { options, coverage, writer, counts, report } = scan;
  const progressEvery = options.progressEvery ?? 100_000;
  for await (const release of iterateReleases(stream)) {
    counts.scanned += 1;
    if (counts.scanned % progressEvery === 0) report("scanning");
    if (!admitRelease(release, options, coverage)) continue;
    counts.matched += 1;
    writer.add(release);
    if (options.limit !== undefined && counts.matched >= options.limit) return true;
  }
  return false;
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

/** Writes releases in batches, one transaction each; a dry run writes nothing. */
class BatchWriter {
  upserted = 0;
  #db: Db;
  #batch: DumpRelease[] = [];
  #batchSize: number;
  #dryRun: boolean;

  constructor(db: Db, options: { batchSize: number; dryRun: boolean }) {
    this.#db = db;
    this.#batchSize = options.batchSize;
    this.#dryRun = options.dryRun;
  }

  add(release: DumpRelease): void {
    this.#batch.push(release);
    if (this.#batch.length >= this.#batchSize) this.flush();
  }

  flush(): void {
    if (this.#batch.length === 0) return;
    if (!this.#dryRun) {
      writeReleases(this.#db, this.#batch.map(dumpReleaseToWrite));
      this.upserted += this.#batch.length;
    }
    this.#batch = [];
  }
}
