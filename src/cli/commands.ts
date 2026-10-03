import fs from "node:fs";
import {
  downloadDump,
  dumpLoad,
  importCollection,
  importHistory,
  importList,
  importSeller,
  importWantlist,
} from "../server/jobs/index.ts";
import { saveConfig } from "../server/config-file.ts";
import { localDay, writeBackup } from "../server/db/backup.ts";
import { restoreBackedUpData } from "../server/db/user-data.ts";
import { readDecisionsBackup, writeDecisionsBackup } from "../server/decisions-backup.ts";
import { createDataDumpClient } from "../server/discogs/data-dumps.ts";
import { createJobRunner } from "../server/jobs/runner.ts";
import { createServer } from "../server/server.ts";
import { SHIPPED_CENSUS_FILE } from "../server/style-census.ts";
import type { Config } from "../shared/config.ts";
import { formatStyleCensus } from "../shared/style-census.ts";
import { countStyleCensus } from "../../tools/dump/census.ts";
import { computeStats } from "../server/stats.ts";
import type { SeedImportResult } from "../server/importers/collection.ts";
import type { ListImportResult } from "../server/importers/list.ts";
import type { SellerImportResult } from "../server/importers/seller.ts";
import {
  parseCensusOptions,
  parseDumpOptions,
  parseImportOptions,
  parseRestoreOptions,
  parseServeOptions,
  type ImportCommand,
} from "./options.ts";
import {
  showBackup,
  showCensus,
  showDownload,
  showDump,
  showImport,
  showRestore,
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
  const deps = {
    dumps: createDataDumpClient({ baseUrl: runtime.dataDumpsUrl }),
    logger: runtime.logger,
  };
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

/** The monthly update: the newest dump unless the folder has it, then a load of it. */
export async function cmdDumpUpdate(runtime: Runtime): Promise<void> {
  const deps = {
    dumps: createDataDumpClient({ baseUrl: runtime.dataDumpsUrl }),
    logger: runtime.logger,
  };
  const report = downloadReporter();
  const { result } = await withDatabase(runtime, (db) => {
    const jobs = createJobRunner(db, runtime.logger);
    return jobs.runAndWait("dump_update", async ({ signal, onProgress }) => {
      const dumpsDir = runtime.paths.dumpsDir;
      const download = await downloadDump(deps, { dumpsDir, signal }, (progress) => {
        onProgress({ step: "download", ...progress });
        report(progress);
      });
      showDownload(download);
      const options = parseDumpOptions([download.path], runtime.config);
      return dumpLoad({ db, logger: runtime.logger }, options, (progress) =>
        onProgress({ step: "load", ...progress }),
      );
    });
  });
  showDump(result);
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

/** Counts a dump's style census into the shipped file, or --out (docs/STYLE_CENSUS.md). */
export async function cmdDumpCensus(runtime: Runtime, args: string[]): Promise<void> {
  const { file, out } = parseCensusOptions(args, SHIPPED_CENSUS_FILE);
  const census = await countStyleCensus(file, { logger: runtime.logger });
  const text = formatStyleCensus(census);
  fs.writeFileSync(out, text);
  showCensus({ census, out, bytes: Buffer.byteLength(text) });
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

export async function cmdStats(runtime: Runtime): Promise<void> {
  const stats = await withDatabase(runtime, (db) => computeStats(db, runtime.config));
  showStats(stats, runtime.config.filters);
}

export async function cmdBackup(runtime: Runtime): Promise<void> {
  const now = new Date();
  const options = {
    dir: runtime.paths.backupsDir,
    day: localDay(now),
    now,
    config: runtime.config,
  };
  const backups = await withDatabase(runtime, async (db) => [
    await writeBackup(db, options),
    await writeDecisionsBackup(db, options),
  ]);
  for (const backup of backups) showBackup(backup);
}

/** Restores a decisions backup into the library, after copying the database as it is. */
export async function cmdRestore(runtime: Runtime, args: string[]): Promise<void> {
  const { file, restoreConfig } = parseRestoreOptions(args, runtime.paths.backupsDir);
  const backup = readDecisionsBackup(file);
  if (restoreConfig && !backup.config) throw new Error("This backup has no configuration.");

  const { copy, outcome } = await withDatabase(runtime, async (db) => {
    const copy = await writeBackup(db, {
      dir: runtime.paths.backupsDir,
      day: localDay(new Date()),
    });
    return { copy, outcome: restoreBackedUpData(db, backup, backup.backedUpAt) };
  });
  if (restoreConfig && backup.config) replaceConfigFile(runtime.paths.configFile, backup.config);

  showRestore({ file, backup, copy, outcome });
}

/** Keeps the settings being replaced next to the file, as `digga.config.json.before-restore`. */
function replaceConfigFile(configFile: string, config: Config): void {
  fs.copyFileSync(configFile, `${configFile}.before-restore`);
  saveConfig(configFile, config);
}

export async function cmdServe(runtime: Runtime, args: string[]): Promise<void> {
  const options = parseServeOptions(args);
  const server = createServer(runtime);
  const info = await server.start(options.port, options.host);
  console.log(`digga serving on ${info.browserUrl}`);
  console.log(`library: ${runtime.paths.dataDir}`);
  console.log(`dumps: ${runtime.paths.dumpsDir}`);
  if (server.getConfig().sandbox)
    console.log("sandbox mode: verdicts stay in the browser; turn it off in Settings to save them");
  const shutdown = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  // A parent with an IPC channel, such as the end-to-end harness, stops the server by message,
  // which also works on Windows, or by going away.
  if (process.send) {
    process.on("message", (message) => {
      if (message === "shutdown") shutdown();
    });
    process.once("disconnect", shutdown);
  }
}
