import { type DumpLoadOptions, type DumpLoadResult, loadDump } from "../../../tools/dump/load.ts";
import type { DumpLoadProgress } from "../../shared/types.ts";
import { type Db, setMeta } from "../db/db.ts";
import { coverageIds } from "../queue/coverage.ts";
import { requeueNoAudio } from "../queue/no-audio.ts";
import type { Logger } from "../logger.ts";

export interface DumpLoadDeps {
  db: Db;
  logger: Logger;
}

export interface DumpLoadJobOptions extends DumpLoadOptions {
  /** Adds the labels and artists of the records the user wants or owns (universe.coverage). */
  coverage: boolean;
}

/**
 * Job wrapper around the streaming loader. Records the dump date in meta.
 * Serialisable options only, so the same function runs inline (CLI) or in a Worker (server).
 */
export async function dumpLoad(
  deps: DumpLoadDeps,
  options: DumpLoadJobOptions,
  onProgress?: (progress: DumpLoadProgress) => void,
): Promise<DumpLoadResult> {
  const criteria = options.coverage ? withCoverage(deps, options) : options;
  const result = await loadDump(deps.db, criteria, { onProgress, logger: deps.logger });
  if (result.dryRun) return result;
  if (result.dumpDate) setMeta(deps.db, "dump_date", result.dumpDate);
  setMeta(deps.db, "dump_file", options.file);
  setMeta(deps.db, "dump_loaded_at", new Date().toISOString());
  const requeued = requeueNoAudio(deps.db);
  if (requeued.length > 0)
    deps.logger.info(`${requeued.length} no-audio record(s) have a new video; back in the queue`);
  return result;
}

/** Adds the coverage labels and artists, read from the verdicts now, to any given ones. */
function withCoverage(deps: DumpLoadDeps, options: DumpLoadOptions): DumpLoadOptions {
  const covered = coverageIds(deps.db);
  const labelIds = [...new Set([...(options.labelIds ?? []), ...covered.labelIds])];
  const artistIds = [...new Set([...(options.artistIds ?? []), ...covered.artistIds])];
  deps.logger.info(`coverage pass over ${labelIds.length} labels and ${artistIds.length} artists`);
  return { ...options, labelIds, artistIds };
}
