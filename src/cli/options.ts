import { parseArgs } from "node:util";
import { readIdList, type DumpLoadOptions } from "../../tools/dump/load.ts";
import type { Config } from "../shared/config.ts";
import { BROWSERS } from "../shared/api.ts";
import type { SeedImportOptions } from "../server/importers/collection.ts";
import type { HistoryImportOptions } from "../server/importers/history.ts";
import type { ListImportOptions } from "../server/importers/list.ts";
import type { EnrichOptions, QueueEnrichOptions } from "../server/jobs/enrich.ts";
import { integerOption } from "./args.ts";

export type ImportCommand =
  | { kind: "history"; options: HistoryImportOptions }
  | { kind: "list"; options: ListImportOptions }
  | { kind: "collection" | "wantlist"; options: SeedImportOptions };

export function parseDumpOptions(args: string[], config: Config): DumpLoadOptions {
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
  if (!file) throw new Error("dump load needs a file path or - for stdin");
  return {
    file,
    styles: config.universe.styles,
    loadYears: config.universe.loadYears,
    limit: integerOption(values.limit, "limit", { min: 1 }),
    dryRun: values["dry-run"],
    labelIds: values.labels ? readIdList(values.labels) : undefined,
    artistIds: values.artists ? readIdList(values.artists) : undefined,
  };
}

export function parseImportOptions(args: string[], config: Config, tempDir: string): ImportCommand {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { browser: { type: "string" }, path: { type: "string" }, list: { type: "string" } },
  });
  const kind = positionals[0];
  if (kind === "history") {
    const browser = BROWSERS.find((browser) => browser === values.browser);
    if (values.browser !== undefined && browser === undefined)
      throw new Error(`--browser must be one of ${BROWSERS.join(", ")}`);
    return { kind, options: { browser, path: values.path, tempDir } };
  }
  if (kind === "list") {
    const listId = integerOption(values.list, "list", { min: 1 }) ?? config.discogs.maybeListId;
    if (listId === null)
      throw new Error(
        "set discogs.maybeListId in digga.config.json (or Settings) or pass --list ID",
      );
    return { kind, options: { listId, currency: config.discogs.currency } };
  }
  if (kind !== "collection" && kind !== "wantlist")
    throw new Error("import needs one of: collection, wantlist, history, list");
  return { kind, options: { username: config.discogs.username } };
}

export type EnrichCommand =
  | { target: "queue"; options: QueueEnrichOptions }
  | { target: "twelves"; options: EnrichOptions };

export function parseEnrichOptions(args: string[], config: Config): EnrichCommand {
  const { values } = parseArgs({
    args,
    options: {
      ahead: { type: "string" },
      all: { type: "boolean", default: false },
      twelves: { type: "boolean", default: false },
    },
  });
  if (values.all && values.ahead !== undefined) throw new Error("use --ahead N or --all, not both");
  const limit = integerOption(values.ahead, "ahead", { min: 1 });
  const currency = config.discogs.currency;
  if (values.twelves) {
    const ahead = values.all ? null : (limit ?? null);
    return { target: "twelves", options: { ahead, currency } };
  }
  const ahead = values.all ? null : (limit ?? 200);
  const queue = { filters: config.filters, strategy: config.queue.strategy };
  return { target: "queue", options: { ahead, currency, ...queue } };
}

export function parseServeOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, host: { type: "string" } },
  });
  return { port: integerOption(values.port, "port", { max: 65535 }), host: values.host };
}
