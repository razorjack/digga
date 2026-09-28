import fs from "node:fs";
import { readIdList } from "../../../tools/dump/load.ts";
import type {
  DumpLoadJobInput,
  EnrichJobOptions,
  ImportJobInput,
  ImportKind,
} from "../../shared/api.ts";
import type { Job } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import { resolveDumpFile } from "../paths.ts";
import {
  dumpLoad,
  enrich,
  enrichTwelves,
  importCollection,
  importHistory,
  importList,
  importWantlist,
} from "./index.ts";
import type { DumpLoadWorkerData } from "./dump-load-worker.ts";

const DUMP_LOAD_WORKER = new URL("./dump-load-worker.ts", import.meta.url);

export class JobInputError extends Error {}

export function startDumpLoad(context: AppContext, input: DumpLoadJobInput): Job {
  const workerData = prepareDumpLoad(context, input);
  if (context.paths.dbFile === ":memory:") {
    // In-memory servers cannot share their connection with a worker.
    return context.jobs.run("dump_load", ({ onProgress }) =>
      dumpLoad({ db: context.db, logger: context.logger }, workerData.options, onProgress),
    );
  }
  return context.jobs.runInWorker("dump_load", DUMP_LOAD_WORKER, workerData);
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
    },
  };
}

export function startEnrich(context: AppContext, options: EnrichJobOptions): Job {
  const { target, ahead } = options;
  const config = context.getConfig();
  const deps = { db: context.db, discogs: context.getDiscogs(), logger: context.logger };
  const currency = config.discogs.currency;
  if (target === "twelves") {
    return context.jobs.run("enrich_twelves", ({ signal, onProgress }) =>
      enrichTwelves(deps, { ahead, currency, signal }, onProgress),
    );
  }
  const queue = { filters: config.filters, strategy: config.queue.strategy };
  return context.jobs.run("enrich", ({ signal, onProgress }) =>
    enrich(deps, { ahead, currency, ...queue, signal }, onProgress),
  );
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
