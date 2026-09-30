import {
  type DumpLoadOptions,
  type DumpLoadResult,
  dumpDateFromFilename,
  loadDump,
} from "../../../tools/dump/load.ts";
import { StyleCensusTally } from "../../../tools/dump/census.ts";
import type { GrowingFile } from "../../../tools/dump/growing.ts";
import type { DumpLoadSummary } from "../../shared/api.ts";
import type { DumpLoadProgress } from "../../shared/types.ts";
import { type Db, nowIso, setMeta } from "../db/db.ts";
import { finishDumpLoadRecord, startDumpLoadRecord } from "../db/dump-loads.ts";
import { saveStyleCensus } from "../db/style-census.ts";
import { coverageIds } from "../queue/coverage.ts";
import { requeueNoAudio } from "../queue/no-audio.ts";
import { followDownload } from "./follow-download.ts";
import type { Logger } from "../logger.ts";

export interface DumpLoadDeps {
  db: Db;
  logger: Logger;
}

export interface DumpLoadJobOptions extends DumpLoadOptions {
  /** Adds the labels and artists of the records the user wants or owns (universe.coverage). */
  coverage: boolean;
  /** The download job still writing the dump; the load reads it as it arrives. */
  followJobId?: string;
}

export interface DumpLoadJobResult extends DumpLoadResult {
  /** What the load changed; null for a dry run, which records nothing. */
  load: DumpLoadSummary | null;
}

/**
 * Job wrapper around the streaming loader. Records the load, so the releases it adds can be dug
 * on their own, and the dump date in meta; then brings back no-audio records with a new video.
 * Serialisable options only, so the same function runs inline (CLI) or in a Worker (server).
 */
export async function dumpLoad(
  deps: DumpLoadDeps,
  options: DumpLoadJobOptions,
  onProgress?: (progress: DumpLoadProgress) => void,
): Promise<DumpLoadJobResult> {
  const criteria = options.coverage ? withCoverage(deps, options) : options;
  const growing = options.followJobId ? followDownload(deps.db, options.followJobId) : undefined;
  if (options.dryRun) {
    const result = await loadDump(deps.db, criteria, { onProgress, logger: deps.logger, growing });
    return { ...result, load: null };
  }

  const { result, load } = await recordedLoad(deps, criteria, { onProgress, growing });
  recordDumpMeta(deps.db, load);
  logLoad(deps.logger, load);
  const requeued = requeueNoAudio(deps.db);
  if (requeued.length > 0)
    deps.logger.info(`${requeued.length} no-audio record(s) have a new video; back in the queue`);
  return { ...result, load };
}

/**
 * Loads the dump as a recorded load: the releases it brings into the universe carry its id, and
 * its last progress says how many it added and did not find. A complete load also replaces the
 * style census.
 */
async function recordedLoad(
  deps: DumpLoadDeps,
  criteria: DumpLoadOptions,
  hooks: { onProgress?: (progress: DumpLoadProgress) => void; growing?: GrowingFile },
): Promise<{ result: DumpLoadResult; load: DumpLoadSummary }> {
  const { onProgress, growing } = hooks;
  const loadId = startDumpLoadRecord(deps.db, {
    file: criteria.file,
    dumpDate: dumpDateFromFilename(criteria.file),
    startedAt: nowIso(),
  });
  const latest: { progress: DumpLoadProgress | null } = { progress: null };
  const remember = (progress: DumpLoadProgress) => {
    latest.progress = progress;
    onProgress?.(progress);
  };
  const census = new StyleCensusTally();
  const result = await loadDump(
    deps.db,
    { ...criteria, loadId },
    { onProgress: remember, logger: deps.logger, census, growing },
  );
  const finishedAt = nowIso();
  const load = finishDumpLoadRecord(deps.db, loadId, {
    coverage: result.coverage,
    complete: !result.stoppedAtLimit,
    finishedAt,
  });
  if (!result.stoppedAtLimit) saveStyleCensus(deps.db, census.finish(result.dumpDate), finishedAt);
  if (latest.progress)
    onProgress?.({ ...latest.progress, added: load.added, missing: load.missing });
  return { result, load };
}

function recordDumpMeta(db: Db, load: DumpLoadSummary): void {
  if (load.dumpDate) setMeta(db, "dump_date", load.dumpDate);
  setMeta(db, "dump_file", load.file);
  setMeta(db, "dump_loaded_at", load.finishedAt ?? nowIso());
}

function logLoad(logger: Logger, load: DumpLoadSummary): void {
  const missing = load.missing === null ? "" : `, did not find ${load.missing}`;
  logger.info(`the load added ${load.added} releases (${load.coverage} by coverage)${missing}`);
}

/** Adds the coverage labels and artists, read from the verdicts now, to any given ones. */
function withCoverage(deps: DumpLoadDeps, options: DumpLoadOptions): DumpLoadOptions {
  const covered = coverageIds(deps.db);
  const labelIds = [...new Set([...(options.labelIds ?? []), ...covered.labelIds])];
  const artistIds = [...new Set([...(options.artistIds ?? []), ...covered.artistIds])];
  deps.logger.info(`coverage pass over ${labelIds.length} labels and ${artistIds.length} artists`);
  return { ...options, labelIds, artistIds };
}
