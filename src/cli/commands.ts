import {
  downloadDump,
  dumpLoad,
  enrich,
  enrichTwelves,
  importCollection,
  importHistory,
  importList,
  importSeller,
  importWantlist,
} from "../server/jobs/index.ts";
import { localDay, writeBackup } from "../server/db/backup.ts";
import { createDataDumpClient } from "../server/discogs/data-dumps.ts";
import { createJobRunner } from "../server/jobs/runner.ts";
import { createServer } from "../server/server.ts";
import { computeStats } from "../server/stats.ts";
import type { SeedImportResult } from "../server/importers/collection.ts";
import type { ListImportResult } from "../server/importers/list.ts";
import type { SellerImportResult } from "../server/importers/seller.ts";
import type { EnrichResult } from "../server/jobs/enrich.ts";
import type { Db } from "../server/db/db.ts";
import {
  parseDumpOptions,
  parseEnrichOptions,
  parseImportOptions,
  parseServeOptions,
  type EnrichCommand,
  type ImportCommand,
} from "./options.ts";
import {
  showBackup,
  showDownload,
  showDump,
  showEnrichment,
  showImport,
  showStats,
  downloadReporter,
} from "./report.ts";
import { type Runtime, discogsFor, withDatabase } from "./runtime.ts";

export type ImportResult =
  | SeedImportResult
  | ListImportResult
  | SellerImportResult
  | ({ kind: "history" } & Awaited<ReturnType<typeof importHistory>>);

export async function cmdDumpDownload(runtime: Runtime): Promise<void> {
  const deps = { dumps: createDataDumpClient(), logger: runtime.logger };
  const report = downloadReporter();
  const { result } = await withDatabase(runtime, (db) => {
    const jobs = createJobRunner(db, runtime.logger);
    return jobs.runAndWait("dump_download", ({ signal, onProgress }) =>
      downloadDump(deps, { dumpsDir: runtime.paths.dumpsDir, signal }, (progress) => {
        onProgress(progress);
        report(progress);
      }),
    );
  });
  showDownload(result);
}

export async function cmdDumpLoad(runtime: Runtime, args: string[]): Promise<void> {
  const options = parseDumpOptions(args, runtime.config);
  const { result } = await withDatabase(runtime, (db) => {
    const jobs = createJobRunner(db, runtime.logger);
    return jobs.runAndWait("dump_load", ({ onProgress }) =>
      dumpLoad({ db, logger: runtime.logger }, options, onProgress),
    );
  });
  showDump(result);
}

export async function cmdImport(runtime: Runtime, args: string[]): Promise<void> {
  const command = parseImportOptions(args, runtime.config, runtime.paths.tempDir);
  const result = await runImport(runtime, command);
  showImport(result);
}

async function runImport(runtime: Runtime, command: ImportCommand): Promise<ImportResult> {
  return withDatabase(runtime, async (db) => {
    const jobs = createJobRunner(db, runtime.logger);
    const { kind, options } = command;
    if (kind === "history") {
      const { result } = await jobs.runAndWait("import_history", ({ signal, onProgress }) =>
        importHistory({ db, logger: runtime.logger }, { ...options, signal }, onProgress),
      );
      return { kind, ...result };
    }
    const discogs = discogsFor(runtime);
    const deps = { db, discogs, logger: runtime.logger };
    if (kind === "list") {
      const { result } = await jobs.runAndWait("import_list", ({ signal, onProgress }) =>
        importList(deps, { ...options, signal }, onProgress),
      );
      return result;
    }
    if (kind === "seller") {
      const { result } = await jobs.runAndWait("import_seller", ({ signal, onProgress }) =>
        importSeller(deps, { ...options, signal }, onProgress),
      );
      return result;
    }
    if (!discogs.hasToken())
      runtime.logger.warn(
        "DISCOGS_TOKEN not set; collection/wantlist of private profiles will fail",
      );
    const jobType = kind === "collection" ? "import_collection" : "import_wantlist";
    const importSeeds = kind === "collection" ? importCollection : importWantlist;
    const { result } = await jobs.runAndWait(jobType, ({ signal, onProgress }) =>
      importSeeds(deps, { ...options, signal }, onProgress),
    );
    return result;
  });
}

export async function cmdEnrich(runtime: Runtime, args: string[]): Promise<void> {
  const command = parseEnrichOptions(args, runtime.config);
  const controller = new AbortController();
  const stop = () => {
    runtime.logger.warn("stopping after the current release");
    controller.abort();
  };
  process.once("SIGINT", stop);
  try {
    const result = await withDatabase(runtime, (db) =>
      runEnrich(runtime, db, command, controller.signal),
    );
    showEnrichment(result);
  } finally {
    process.removeListener("SIGINT", stop);
  }
}

async function runEnrich(
  runtime: Runtime,
  db: Db,
  command: EnrichCommand,
  signal: AbortSignal,
): Promise<EnrichResult> {
  const jobs = createJobRunner(db, runtime.logger);
  const deps = { db, discogs: discogsFor(runtime), logger: runtime.logger };
  if (command.target === "twelves") {
    const { result } = await jobs.runAndWait("enrich_twelves", ({ onProgress }) =>
      enrichTwelves(deps, { ...command.options, signal }, onProgress),
    );
    return result;
  }
  const { result } = await jobs.runAndWait("enrich", ({ onProgress }) =>
    enrich(deps, { ...command.options, signal }, onProgress),
  );
  return result;
}

export async function cmdStats(runtime: Runtime): Promise<void> {
  const stats = await withDatabase(runtime, (db) => computeStats(db, runtime.config));
  showStats(stats, runtime.config.filters);
}

export async function cmdBackup(runtime: Runtime): Promise<void> {
  const backup = await withDatabase(runtime, (db) =>
    writeBackup(db, { dir: runtime.paths.backupsDir, day: localDay(new Date()) }),
  );
  showBackup(backup);
}

export async function cmdServe(runtime: Runtime, args: string[]): Promise<void> {
  const options = parseServeOptions(args);
  const server = createServer(runtime);
  const info = await server.start(options.port, options.host);
  console.log(`digga serving on ${info.browserUrl} (data: ${runtime.paths.dataDir})`);
  if (server.getConfig().sandbox)
    console.log("sandbox mode: verdicts stay in the browser; turn it off in Settings to save them");
  const shutdown = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
