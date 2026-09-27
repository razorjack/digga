import { type DumpLoadOptions, type DumpLoadResult, loadDump } from "../../../tools/dump/load.ts";
import type { DumpLoadProgress } from "../../shared/types.ts";
import { type Db, setMeta } from "../db/db.ts";
import type { Logger } from "../logger.ts";

export interface DumpLoadDeps {
  db: Db;
  logger: Logger;
}

/**
 * Job wrapper around the streaming loader. Records the dump date in meta.
 * Serialisable options only, so the same function runs inline (CLI) or in a Worker (server).
 */
export async function dumpLoad(
  deps: DumpLoadDeps,
  opts: DumpLoadOptions,
  onProgress?: (p: DumpLoadProgress) => void,
): Promise<DumpLoadResult> {
  const result = await loadDump(deps.db, opts, { onProgress, logger: deps.logger });
  if (!result.dryRun) {
    if (result.dumpDate) setMeta(deps.db, "dump_date", result.dumpDate);
    setMeta(deps.db, "dump_file", opts.file);
    setMeta(deps.db, "dump_loaded_at", new Date().toISOString());
  }
  return result;
}
