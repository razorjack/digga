#!/usr/bin/env node
/**
 * Digga command line. Every command is a thin wrapper over a job function or createServer.
 * This file (and paths.ts/secrets.ts) are the only places allowed to read process.env / process.cwd().
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../server/config-file.ts";
import { openDb } from "../server/db/db.ts";
import { createDiscogsClient } from "../server/discogs/client.ts";
import {
  dumpLoad,
  enrich,
  importCollection,
  importHistory,
  importList,
  importWantlist,
} from "../server/jobs/index.ts";
import { createJobRunner } from "../server/jobs/runner.ts";
import { createLogger, type LogLevel } from "../server/logger.ts";
import { resolvePaths } from "../server/paths.ts";
import { createSecrets } from "../server/secrets.ts";
import { createServer } from "../server/server.ts";
import { computeStats } from "../server/stats.ts";
import { BROWSERS, type Browser } from "../shared/api.ts";
import { readIdList } from "../../tools/dump/load.ts";

const HELP = `digga - dig Discogs vinyl by ear

Usage: digga <command> [options]

Commands:
  dump load <file|->        Stream a Discogs releases dump (.xml.gz, .xml or XML on stdin)
                            into the local universe, filtered by config universe.styles.
      --limit N             Stop after N matching releases (dev aid)
      --dry-run             Count matches without writing
      --labels FILE         Match by label ids listed in FILE (one per line), any style
      --artists FILE        Match by artist ids listed in FILE, any style
  import collection         Seed verdicts from your Discogs collection
  import wantlist           Seed verdicts from your Discogs wantlist
  import history            Mark releases you already opened on discogs.com as seen
      --browser NAME        brave (default) | chrome | firefox
      --path FILE           Explicit History / places.sqlite file
  import list               Mark the releases on your Discogs Maybe list as maybe
      --list ID             Another list than discogs.maybeListId
  enrich [--ahead N]        Fetch price, have/want and fresh videos for the next N queue items (default 200)
  stats                     Print universe size, verdict counts, remaining and ETA
  serve [--port N] [--host H]
                            Start the local server (default 127.0.0.1:3456; --port 0 picks a free port)
  help                      Show this help

Environment:
  DIGGA_DATA_DIR            Data directory (default ./data)
  DIGGA_CONFIG_FILE         Config file (default ./digga.config.json)
  DISCOGS_TOKEN             Personal access token (or put it in .env)
  DIGGA_LOG_LEVEL           debug | info | warn | error
`;

interface Runtime {
  paths: ReturnType<typeof resolvePaths>;
  config: ReturnType<typeof loadConfig>;
  secrets: ReturnType<typeof createSecrets>;
  logger: ReturnType<typeof createLogger>;
}

function boot(): Runtime {
  const cwd = process.cwd();
  const paths = resolvePaths({ baseDir: cwd });
  const config = loadConfig(paths.configFile, paths.configExampleFile);
  const secrets = createSecrets({ envFile: paths.envFile });
  const level = (process.env.DIGGA_LOG_LEVEL as LogLevel | undefined) ?? "info";
  const logger = createLogger({ level });
  return { paths, config, secrets, logger };
}

function fail(message: string): never {
  console.error(`digga: ${message}`);
  process.exit(1);
}

function intOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) fail(`--${name} must be a non-negative integer`);
  return n;
}

async function cmdDumpLoad(rt: Runtime, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      labels: { type: "string" },
      artists: { type: "string" },
    },
  });
  const file = positionals[0];
  if (!file) fail("dump load needs a file path or - for stdin");
  const db = openDb(rt.paths.dbFile);
  const runner = createJobRunner(db, rt.logger);
  const { result } = await runner.runAndWait("dump_load", ({ onProgress }) =>
    dumpLoad(
      { db, logger: rt.logger },
      {
        file,
        styles: rt.config.universe.styles,
        loadYears: rt.config.universe.loadYears,
        limit: intOption(values.limit, "limit"),
        dryRun: values["dry-run"],
        labelIds: values.labels ? readIdList(values.labels) : undefined,
        artistIds: values.artists ? readIdList(values.artists) : undefined,
      },
      onProgress,
    ),
  );
  db.close();
  const r = result as Awaited<ReturnType<typeof dumpLoad>>;
  console.log(
    `dump load: scanned ${r.scanned.toLocaleString()} releases, matched ${r.matched.toLocaleString()}, ` +
      `${r.dryRun ? "dry run, nothing written" : `upserted ${r.upserted.toLocaleString()}`} in ${r.elapsedSeconds.toFixed(0)}s` +
      (r.dumpDate ? ` (dump ${r.dumpDate})` : ""),
  );
}

async function cmdImport(rt: Runtime, args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { browser: { type: "string" }, path: { type: "string" }, list: { type: "string" } },
  });
  const kind = positionals[0];
  const db = openDb(rt.paths.dbFile);
  const runner = createJobRunner(db, rt.logger);
  if (kind === "history") {
    const browser = values.browser as Browser | undefined;
    if (browser && !BROWSERS.includes(browser))
      fail(`--browser must be one of ${BROWSERS.join(", ")}`);
    const { result } = await runner.runAndWait("import_history", ({ signal, onProgress }) =>
      importHistory(
        { db, logger: rt.logger },
        { browser, path: values.path, tempDir: rt.paths.tempDir, signal },
        onProgress,
      ),
    );
    db.close();
    const r = result as Awaited<ReturnType<typeof importHistory>>;
    console.log(
      `import history: ${r.files} file(s), ${r.discogsUrls} Discogs URLs, ${r.keys} releases/masters marked seen (${r.verdictsWritten} new)`,
    );
    return;
  }
  if (kind === "list") {
    const listId = intOption(values.list, "list") ?? rt.config.discogs.maybeListId;
    if (!listId)
      fail("set discogs.maybeListId in digga.config.json (or Settings) or pass --list ID");
    const discogs = createDiscogsClient({
      token: rt.secrets.getDiscogsToken(),
      logger: rt.logger.child("discogs"),
    });
    const { result } = await runner.runAndWait("import_list", ({ signal, onProgress }) =>
      importList(
        { db, discogs, logger: rt.logger },
        { listId, currency: rt.config.discogs.currency, signal },
        onProgress,
      ),
    );
    db.close();
    const r = result as Awaited<ReturnType<typeof importList>>;
    console.log(
      `import list "${r.listName}": ${r.processed} items, ${r.stubs} stub releases, ${r.verdictsWritten} verdicts written`,
    );
    return;
  }
  if (kind !== "collection" && kind !== "wantlist")
    fail("import needs one of: collection, wantlist, history, list");
  const discogs = createDiscogsClient({
    token: rt.secrets.getDiscogsToken(),
    logger: rt.logger.child("discogs"),
  });
  if (!discogs.hasToken())
    rt.logger.warn("DISCOGS_TOKEN not set; collection/wantlist of private profiles will fail");
  const deps = { db, discogs, logger: rt.logger };
  const opts = { username: rt.config.discogs.username };
  const { result } = await runner.runAndWait(
    kind === "collection" ? "import_collection" : "import_wantlist",
    ({ signal, onProgress }) =>
      kind === "collection"
        ? importCollection(deps, { ...opts, signal }, onProgress)
        : importWantlist(deps, { ...opts, signal }, onProgress),
  );
  db.close();
  const r = result as Awaited<ReturnType<typeof importCollection>>;
  console.log(
    `import ${kind}: ${r.processed} items over ${r.pages ?? 0} page(s), ${r.stubs} stub releases, ${r.verdictsWritten} verdicts written`,
  );
}

async function cmdEnrich(rt: Runtime, args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { ahead: { type: "string" } } });
  const ahead = intOption(values.ahead, "ahead") ?? 200;
  const db = openDb(rt.paths.dbFile);
  const runner = createJobRunner(db, rt.logger);
  const discogs = createDiscogsClient({
    token: rt.secrets.getDiscogsToken(),
    logger: rt.logger.child("discogs"),
  });
  const controller = new AbortController();
  process.once("SIGINT", () => {
    rt.logger.warn("stopping after the current release");
    controller.abort();
  });
  const { result } = await runner.runAndWait("enrich", ({ onProgress }) =>
    enrich(
      { db, discogs, logger: rt.logger },
      {
        ahead,
        currency: rt.config.discogs.currency,
        filters: rt.config.filters,
        strategy: rt.config.queue.strategy,
        signal: controller.signal,
      },
      onProgress,
    ),
  );
  db.close();
  const r = result as Awaited<ReturnType<typeof enrich>>;
  console.log(
    `enrich: ${r.done}/${r.total} releases enriched, ${r.failed} failed${r.aborted ? ", aborted" : ""}`,
  );
}

function cmdStats(rt: Runtime): void {
  const db = openDb(rt.paths.dbFile);
  const s = computeStats(db, rt.config);
  db.close();
  const f = rt.config.filters;
  const years = `${f.yearFrom ?? "…"}-${f.yearTo ?? "…"}${f.includeUnknownYear ? " (+unknown)" : ""}`;
  console.log(
    `universe:  ${s.universe.releases.toLocaleString()} releases, ${s.universe.keys.toLocaleString()} triage keys`,
  );
  console.log(
    `filtered:  ${s.universe.filteredKeys.toLocaleString()} keys (${years}, ${f.formats.join("/") || "any format"})`,
  );
  console.log(
    `verdicts:  ${Object.entries(s.verdicts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  console.log(`heard:     ${s.heardTracks.toLocaleString()} tracks`);
  console.log(
    `dump:      ${s.dump.date ?? (s.dump.loadedAt ? "unknown date" : "not loaded")}${s.dump.loadedAt ? ` (loaded ${s.dump.loadedAt})` : ""}`,
  );
  const rate =
    s.rate.verdictsPerHour === null
      ? "n/a"
      : `${s.rate.verdictsPerHour}/h over ${s.rate.sessions} session(s)`;
  const eta = s.rate.etaHours === null ? "n/a" : `${s.rate.etaHours} h`;
  console.log(
    `dug:       ${s.dug.toLocaleString()}, ${s.remaining.toLocaleString()} to go, rate ${rate}, ETA ${eta}`,
  );
}

async function cmdServe(rt: Runtime, args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, host: { type: "string" } },
  });
  const port = intOption(values.port, "port");
  const server = createServer({
    config: rt.config,
    paths: rt.paths,
    secrets: rt.secrets,
    logger: rt.logger,
  });
  const info = await server.start(port, values.host);
  console.log(`digga serving on ${info.browserUrl} (data: ${rt.paths.dataDir})`);
  const shutdown = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  const rt = boot();
  switch (command) {
    case "dump":
      if (rest[0] !== "load") fail("usage: digga dump load <file|->");
      return cmdDumpLoad(rt, rest.slice(1));
    case "import":
      return cmdImport(rt, rest);
    case "enrich":
      return cmdEnrich(rt, rest);
    case "stats":
      return cmdStats(rt);
    case "serve":
      return cmdServe(rt, rest);
    default:
      fail(`unknown command "${command}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`digga: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
