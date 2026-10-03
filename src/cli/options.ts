import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readIdList } from "../../tools/dump/load.ts";
import type { DumpLoadJobOptions } from "../server/jobs/dump-load.ts";
import type { Config } from "../shared/config.ts";
import { BROWSERS } from "../shared/api.ts";
import type { SeedImportOptions } from "../server/importers/collection.ts";
import type { HistoryImportOptions } from "../server/importers/history.ts";
import type { ListImportOptions } from "../server/importers/list.ts";
import type { SellerImportOptions } from "../server/importers/seller.ts";
import { integerOption } from "./args.ts";

export type ImportCommand =
  | { kind: "history"; options: HistoryImportOptions }
  | { kind: "list"; options: ListImportOptions }
  | { kind: "seller"; options: SellerImportOptions }
  | { kind: "collection" | "wantlist"; options: SeedImportOptions };

export type RestoreCommand =
  | { kind: "decisions"; file: string; restoreConfig: boolean }
  | { kind: "database"; file: string };

export function parseDumpOptions(args: string[], config: Config): DumpLoadJobOptions {
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
    coverage: config.universe.coverage,
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
  if (kind === "seller") {
    const username = positionals[1]?.trim();
    if (!username) throw new Error("import seller needs the seller's Discogs username");
    return { kind, options: { username } };
  }
  if (kind !== "collection" && kind !== "wantlist")
    throw new Error("import needs one of: collection, wantlist, history, list, seller");
  return { kind, options: { username: config.discogs.username } };
}

export function parseServeOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, host: { type: "string" } },
  });
  return { port: integerOption(values.port, "port", { max: 65535 }), host: values.host };
}

/** The dump to count, and where the census goes (by default, the one shipped with Digga). */
export function parseCensusOptions(
  args: string[],
  shippedFile: string,
): { file: string; out: string } {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: "string" } },
  });
  const file = positionals[0];
  if (!file) throw new Error("usage: digga dump census <file> [--out FILE]");
  return { file, out: values.out ?? shippedFile };
}

/**
 * The backup to restore: a path, or the name of one in the backups folder. A `.sqlite` file is a
 * database copy; another is a decisions backup, whose settings `--config` restores too.
 */
export function parseRestoreOptions(args: string[], backupsDir: string): RestoreCommand {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { config: { type: "boolean" } },
  });
  const [name, ...rest] = positionals;
  if (!name || rest.length > 0)
    throw new Error(
      "usage: digga restore <decisions-YYYY-MM-DD.json.gz> [--config] | <digga-YYYY-MM-DD.sqlite>",
    );

  const file = findBackup(name, backupsDir);
  const restoreConfig = values.config ?? false;
  if (path.extname(file) !== ".sqlite") return { kind: "decisions", file, restoreConfig };
  if (restoreConfig)
    throw new Error("--config restores settings from a decisions backup; a database copy has none");
  return { kind: "database", file };
}

function findBackup(name: string, backupsDir: string): string {
  if (fs.existsSync(name) || path.basename(name) !== name) return name;
  return path.join(backupsDir, name);
}
