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

export function matchesUniverse(rel: DumpRelease, c: UniverseCriteria): boolean {
  const byIds = (c.labelIds && c.labelIds.length > 0) || (c.artistIds && c.artistIds.length > 0);
  if (byIds) {
    const labelHit = rel.labels.some((l) => l.id !== null && c.labelIds?.includes(l.id));
    const artistHit = rel.artists.some((a) => a.id !== null && c.artistIds?.includes(a.id));
    return labelHit || artistHit;
  }
  if (!rel.styles.some((s) => c.styles.includes(s))) return false;
  if (c.loadYears) {
    const year = yearFromReleased(rel.released);
    if (year !== null && (year < c.loadYears[0] || year > c.loadYears[1])) return false;
  }
  return true;
}

/** discogs_20250901_releases.xml.gz -> 2025-09-01 */
export function dumpDateFromFilename(file: string): string | null {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(path.basename(file));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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

export function openDumpInput(file: string, stdin: Readable): Readable {
  if (file === "-") return stdin;
  const raw = fs.createReadStream(file);
  if (!file.endsWith(".gz")) return raw;
  const gunzip = zlib.createGunzip();
  pipeline(raw, gunzip, () => {});
  return gunzip;
}

/**
 * Streams the dump, keeps the releases matching the universe criteria and upserts
 * them with their tracks and videos. Safe to run in a worker thread: it only needs
 * a Db it owns and serialisable options.
 */
export async function loadDump(
  db: Db,
  opts: DumpLoadOptions,
  hooks: { onProgress?: (p: DumpLoadProgress) => void; logger?: Logger; stdin?: Readable } = {},
): Promise<DumpLoadResult> {
  const started = Date.now();
  const progressEvery = opts.progressEvery ?? 100_000;
  const batchSize = opts.batchSize ?? 500;
  const dryRun = opts.dryRun ?? false;
  let scanned = 0;
  let matched = 0;
  let upserted = 0;
  let batch: DumpRelease[] = [];
  const elapsed = () => (Date.now() - started) / 1000;
  const report = (phase: DumpLoadProgress["phase"]) => {
    const p: DumpLoadProgress = { phase, scanned, matched, upserted, elapsedSeconds: elapsed() };
    hooks.onProgress?.(p);
    hooks.logger?.info(
      `${phase}: scanned=${scanned} matched=${matched} upserted=${upserted} ${p.elapsedSeconds.toFixed(0)}s`,
    );
  };
  const flush = () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      writeReleases(db, batch.map(dumpReleaseToWrite));
      upserted += batch.length;
    }
    batch = [];
  };

  const stdin = hooks.stdin ?? (process.stdin as Readable);
  const input = openDumpInput(opts.file, stdin);
  try {
    for await (const rel of iterateReleases(input)) {
      scanned += 1;
      if (scanned % progressEvery === 0) report("scanning");
      if (!matchesUniverse(rel, opts)) continue;
      matched += 1;
      batch.push(rel);
      if (batch.length >= batchSize) flush();
      if (opts.limit !== undefined && matched >= opts.limit) break;
    }
  } finally {
    input.destroy();
  }
  flush();
  report("done");
  return {
    scanned,
    matched,
    upserted,
    elapsedSeconds: elapsed(),
    dumpDate: dumpDateFromFilename(opts.file),
    dryRun,
  };
}
