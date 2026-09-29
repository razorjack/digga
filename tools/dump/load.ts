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
import { iterateReleases } from "./parse.ts";
import type { DumpRelease } from "./types.ts";

export interface UniverseCriteria {
  /** Exact Discogs style strings; a release matches when any of its styles is listed. */
  styles: string[];
  /** Wide load window; releases without a year always pass so they can be triaged later. */
  loadYears: [number, number] | null;
  /** Alternative match mode: any style, but label or artist id must be listed. */
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
  matched: number;
  upserted: number;
  elapsedSeconds: number;
  dumpDate: string | null;
  dryRun: boolean;
}

export function matchesUniverse(release: DumpRelease, criteria: UniverseCriteria): boolean {
  const byIds =
    (criteria.labelIds && criteria.labelIds.length > 0) ||
    (criteria.artistIds && criteria.artistIds.length > 0);
  if (byIds) {
    const labelHit = release.labels.some((l) => l.id !== null && criteria.labelIds?.includes(l.id));
    const artistHit = release.artists.some(
      (a) => a.id !== null && criteria.artistIds?.includes(a.id),
    );
    return labelHit || artistHit;
  }
  if (!release.styles.some((s) => criteria.styles.includes(s))) return false;
  if (criteria.loadYears) {
    const year = yearFromReleased(release.released);
    if (year !== null && (year < criteria.loadYears[0] || year > criteria.loadYears[1]))
      return false;
  }
  return true;
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
  const { phase, scanned, matched, upserted, elapsedSeconds } = progress;
  hooks.logger?.info(
    `${phase}: scanned=${scanned} matched=${matched} upserted=${upserted} ${elapsedSeconds.toFixed(0)}s`,
  );
}

/**
 * Streams the dump, keeps the releases matching the universe criteria and upserts
 * them with their tracks and videos. Safe to run in a worker thread: it only needs
 * a Db it owns and serialisable options.
 */
export async function loadDump(
  db: Db,
  options: DumpLoadOptions,
  hooks: DumpLoadHooks = {},
): Promise<DumpLoadResult> {
  const started = Date.now();
  const progressEvery = options.progressEvery ?? 100_000;
  const batchSize = options.batchSize ?? 500;
  const dryRun = options.dryRun ?? false;
  const counts = { scanned: 0, matched: 0, upserted: 0 };
  const batch: DumpRelease[] = [];
  const elapsed = () => (Date.now() - started) / 1000;
  const stdin = hooks.stdin ?? (process.stdin as Readable);
  const input = openDumpInput(options.file, stdin);
  const report = (phase: DumpLoadProgress["phase"]) =>
    reportProgress(
      {
        ...counts,
        phase,
        elapsedSeconds: elapsed(),
        bytesRead: input.bytesRead(),
        totalBytes: input.totalBytes,
      },
      hooks,
    );

  try {
    for await (const release of iterateReleases(input.stream)) {
      counts.scanned += 1;
      if (counts.scanned % progressEvery === 0) report("scanning");
      if (!matchesUniverse(release, options)) continue;
      counts.matched += 1;
      batch.push(release);
      if (batch.length >= batchSize) counts.upserted += flushBatch(db, batch, dryRun);
      if (options.limit !== undefined && counts.matched >= options.limit) break;
    }
  } finally {
    input.stream.destroy();
  }
  counts.upserted += flushBatch(db, batch, dryRun);
  report("done");
  return {
    ...counts,
    elapsedSeconds: elapsed(),
    dumpDate: dumpDateFromFilename(options.file),
    dryRun,
  };
}

function flushBatch(db: Db, batch: DumpRelease[], dryRun: boolean): number {
  if (batch.length === 0) return 0;
  if (!dryRun) writeReleases(db, batch.map(dumpReleaseToWrite));
  const written = dryRun ? 0 : batch.length;
  batch.length = 0;
  return written;
}
