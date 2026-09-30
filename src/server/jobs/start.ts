import fs from "node:fs";
import { readIdList } from "../../../tools/dump/load.ts";
import type { DumpLoadJobInput, ImportJobInput, ImportKind } from "../../shared/api.ts";
import { JOB_LABEL } from "../../shared/job-display.ts";
import type { DumpLoadProgress, Job, JobType } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { resolveDumpFile } from "../paths.ts";
import type { DumpLoadJobResult } from "./dump-load.ts";
import {
  downloadDump,
  dumpLoad,
  importCollection,
  importHistory,
  importList,
  importSeller,
  importWantlist,
} from "./index.ts";
import type { DumpLoadWorkerData } from "./dump-load-worker.ts";
import { runWorker, type WorkerJob } from "./worker.ts";

const DUMP_LOAD_WORKER = new URL("./dump-load-worker.ts", import.meta.url);

/** Jobs that write the dumps folder or load a dump; two at once would write the same file or rows. */
const DUMP_JOBS: JobType[] = ["dump_download", "dump_load", "dump_update"];

export class JobInputError extends Error {}

export function startDumpDownload(context: AppContext): Job {
  refuseWhileDumpJobRuns(context);
  const deps = { dumps: context.dataDumps, logger: context.logger };
  return context.jobs.run("dump_download", ({ signal, onProgress }) =>
    downloadDump(deps, { dumpsDir: context.paths.dumpsDir, signal }, onProgress),
  );
}

export function startDumpLoad(context: AppContext, input: DumpLoadJobInput): Job {
  const workerData = prepareDumpLoad(context, input);
  refuseWhileDumpJobRuns(context);
  return context.jobs.run("dump_load", (job) => runDumpLoad(context, workerData, job));
}

/** The monthly update: downloads the newest dump unless the folder has it, then loads it. */
export function startDumpUpdate(context: AppContext): Job {
  refuseWhileDumpJobRuns(context);
  const deps = { dumps: context.dataDumps, logger: context.logger };
  return context.jobs.run("dump_update", async ({ signal, onProgress }) => {
    const download = await downloadDump(
      deps,
      { dumpsDir: context.paths.dumpsDir, signal },
      (progress) => onProgress({ step: "download", ...progress }),
    );
    const workerData = prepareDumpLoad(context, { file: download.path, dryRun: false });
    return runDumpLoad(context, workerData, {
      signal,
      onProgress: (progress) => onProgress({ step: "load", ...progress }),
    });
  });
}

/** A download, load or update is running; another one, or deleting a dump, has to wait. */
export function refuseWhileDumpJobRuns(context: AppContext): void {
  const running = context.jobs
    .list()
    .find((job) => DUMP_JOBS.includes(job.type) && job.status === "running");
  if (running) throw new JobInputError(`Wait until "${JOB_LABEL[running.type]}" has finished`);
}

/** In a worker with its own connection; an in-memory database cannot be shared, so it loads inline. */
function runDumpLoad(
  context: AppContext,
  workerData: DumpLoadWorkerData,
  job: WorkerJob<DumpLoadProgress>,
): Promise<DumpLoadJobResult> {
  if (context.paths.dbFile === ":memory:")
    return dumpLoad({ db: context.db, logger: context.logger }, workerData.options, job.onProgress);
  return runWorker<DumpLoadJobResult, DumpLoadProgress>(DUMP_LOAD_WORKER, workerData, job);
}

function prepareDumpLoad(context: AppContext, input: DumpLoadJobInput): DumpLoadWorkerData {
  const config = context.getConfig();
  const file = resolveDumpFile(context.paths, input.file);
  if (file === "-") throw new JobInputError("stdin is only supported from the CLI");
  if (!fs.existsSync(file)) throw new JobInputError(`Dump file not found: ${file}`);
  const labelIds = input.labelsFile
    ? readIdList(resolveDumpFile(context.paths, input.labelsFile))
    : undefined;
  const artistIds = input.artistsFile
    ? readIdList(resolveDumpFile(context.paths, input.artistsFile))
    : undefined;
  return {
    dbFile: context.paths.dbFile,
    options: {
      file,
      styles: config.universe.styles,
      loadYears: config.universe.loadYears,
      limit: input.limit,
      dryRun: input.dryRun,
      labelIds,
      artistIds,
      coverage: config.universe.coverage,
    },
  };
}

export function startImport(context: AppContext, kind: ImportKind, input: ImportJobInput): Job {
  const config = context.getConfig();
  const { db, logger, jobs } = context;
  if (kind === "history") {
    return jobs.run("import_history", ({ signal, onProgress }) =>
      importHistory(
        { db, logger },
        { browser: input.browser, path: input.path, tempDir: context.paths.tempDir, signal },
        onProgress,
      ),
    );
  }
  const deps = { db, logger, discogs: context.getDiscogs() };
  if (kind === "seller") {
    const username = input.username;
    if (!username) throw new JobInputError("Name the seller whose shop to read");
    return jobs.run("import_seller", ({ signal, onProgress }) =>
      importSeller(deps, { username, signal }, onProgress),
    );
  }
  if (kind === "list") {
    const listId = input.listId ?? config.discogs.maybeListId;
    if (listId === null)
      throw new JobInputError("Choose your Discogs Maybe list in Settings first");
    return jobs.run("import_list", ({ signal, onProgress }) =>
      importList(deps, { listId, currency: config.discogs.currency, signal }, onProgress),
    );
  }
  const type = kind === "collection" ? "import_collection" : "import_wantlist";
  const importSeeds = kind === "collection" ? importCollection : importWantlist;
  return jobs.run(type, ({ signal, onProgress }) =>
    importSeeds(deps, { username: config.discogs.username, signal }, onProgress),
  );
}
