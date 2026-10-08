import fs from "node:fs";
import path from "node:path";
import { readIdList } from "../../../tools/dump/load.ts";
import type { DumpLoadJobInput, ImportJobInput, ImportKind } from "../../shared/api.ts";
import { JOB_LABEL } from "../../shared/job-display.ts";
import type { DumpLoadProgress, Job, JobType } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { dumpsDirOptions, resolveDumpFile } from "../paths.ts";
import type { DumpLoadJobResult } from "./dump-load.ts";
import {
  downloadDump,
  dumpLoad,
  importCollection,
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
    downloadDump(deps, { ...dumpsDirOptions(context.paths), signal }, onProgress),
  );
}

/** Loads a dump; one still downloading is read as it arrives, so the load starts at once. */
export function startDumpLoad(context: AppContext, input: DumpLoadJobInput): Job {
  const workerData = prepareDumpLoad(context, input);
  refuseWhileDumpJobRuns(context, workerData.options.followJobId);
  return context.jobs.run("dump_load", (job) => runDumpLoad(context, workerData, job));
}

/** The monthly update: downloads the newest dump unless the folder has it, then loads it. */
export function startDumpUpdate(context: AppContext): Job {
  refuseWhileDumpJobRuns(context);
  const deps = { dumps: context.dataDumps, logger: context.logger };
  return context.jobs.run("dump_update", async ({ signal, onProgress }) => {
    const download = await downloadDump(
      deps,
      { ...dumpsDirOptions(context.paths), signal },
      (progress) => onProgress({ step: "download", ...progress }),
    );
    const workerData = prepareDumpLoad(context, { file: download.path, dryRun: false });
    return runDumpLoad(context, workerData, {
      signal,
      onProgress: (progress) => onProgress({ step: "load", ...progress }),
    });
  });
}

/**
 * A download, load or update is running; another one, or deleting a dump, has to wait. A load
 * may start beside the download it reads, `followedJobId`.
 */
export function refuseWhileDumpJobRuns(context: AppContext, followedJobId?: string): void {
  const running = context.jobs
    .list()
    .find(
      (job) => DUMP_JOBS.includes(job.type) && job.status === "running" && job.id !== followedJobId,
    );
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
  return runWorker<DumpLoadJobResult, DumpLoadProgress>(DUMP_LOAD_WORKER, {
    workerData,
    job,
    logger: context.logger,
  });
}

function prepareDumpLoad(context: AppContext, input: DumpLoadJobInput): DumpLoadWorkerData {
  const config = context.getConfig();
  const file = resolveDumpFile(context.paths, input.file);
  if (file === "-") throw new JobInputError("stdin is only supported from the CLI");
  const followJobId = fs.existsSync(file) ? undefined : downloadWriting(context, file)?.id;
  if (!fs.existsSync(file) && !followJobId) throw new JobInputError(`Dump file not found: ${file}`);
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
      followJobId,
    },
  };
}

/** The running download that writes `file`, or will once it has found the newest dump. */
function downloadWriting(context: AppContext, file: string): Job | null {
  if (path.dirname(file) !== context.paths.dumpsDir) return null;
  const download = context.jobs
    .list()
    .find((job) => job.type === "dump_download" && job.status === "running");
  if (download?.type !== "dump_download") return null;
  const writing = download.progress?.file ?? null;
  return writing === null || writing === path.basename(file) ? download : null;
}

export function startImport(context: AppContext, kind: ImportKind, input: ImportJobInput): Job {
  const config = context.getConfig();
  const { db, logger, jobs } = context;
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
