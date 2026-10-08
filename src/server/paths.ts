import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DumpsDirSource } from "../shared/api.ts";

export interface Paths {
  /** The library: database, backups, config, saved token. */
  dataDir: string;
  dbFile: string;
  configFile: string;
  dumpsDir: string;
  /** What named dumpsDir: DIGGA_DUMPS_DIR, the user in the desktop app, or nothing (the default). */
  dumpsDirSource: DumpsDirSource;
  /** The dumps folder the user chose in the desktop app, which DIGGA_DUMPS_DIR overrides. */
  dumpsFolderFile: string;
  /** Daily copies of the database, written when the server starts. */
  backupsDir: string;
  /** Built frontend bundle served by Hono in production. */
  distDir: string;
  /** The Discogs token Settings saves, in .env format; read by secrets.ts. */
  secretsFile: string;
  /** Names the process that owns the library while it runs; see library-lock.ts. */
  lockFile: string;
}

export interface PathOptions {
  /** Where the library lives; by default the per-user app folder (see appFolders). */
  dataDir?: string;
  /**
   * DIGGA_DUMPS_DIR, which wins over the folder chosen in the desktop app. Without either,
   * "dumps" in a dataDir given here, else in the OS cache folder.
   */
  dumpsDir?: string;
  configFile?: string;
  distDir?: string;
}

export interface System {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

export interface AppFolders {
  /** Electron's `app.getPath("userData")` for an app named Digga. */
  data: string;
  /** The OS cache folder, which backups skip and the OS may clear. */
  cache: string;
}

const APP_NAME = "Digga";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** dist/ lives two levels above src/server/. */
export const DEFAULT_DIST_DIR = path.resolve(MODULE_DIR, "..", "..", "dist");

/**
 * Resolves every filesystem location the app uses. This is the only module that decides where
 * user data lives; everything else receives a Paths object.
 */
export function resolvePaths(options: PathOptions = {}, system: System = currentSystem()): Paths {
  const folders = appFolders(system);
  const dataDir = path.resolve(options.dataDir ?? folders.data);
  const dumpsFolderFile = path.join(dataDir, "dumps-folder.json");
  const dumps = resolveDumpsDir(options, { dataDir, dumpsFolderFile, cacheDir: folders.cache });
  return {
    dataDir,
    dbFile: path.join(dataDir, "digga.sqlite"),
    configFile: path.resolve(options.configFile ?? path.join(dataDir, "digga.config.json")),
    dumpsDir: dumps.dir,
    dumpsDirSource: dumps.source,
    dumpsFolderFile,
    backupsDir: path.join(dataDir, "backups"),
    distDir: path.resolve(options.distDir ?? DEFAULT_DIST_DIR),
    secretsFile: path.join(dataDir, "secrets.env"),
    lockFile: path.join(dataDir, "digga.lock"),
  };
}

/**
 * Saves the dumps folder the user chose in the desktop app, which every later resolvePaths()
 * takes unless DIGGA_DUMPS_DIR names one, and returns the paths with it.
 */
export function saveChosenDumpsDir(paths: Paths, folder: string): Paths {
  const tmp = `${paths.dumpsFolderFile}.tmp`;
  fs.mkdirSync(path.dirname(paths.dumpsFolderFile), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify({ dumpsDir: folder }, null, 2)}\n`);
  fs.renameSync(tmp, paths.dumpsFolderFile);
  return { ...paths, dumpsDir: folder, dumpsDirSource: "chosen" };
}

function currentSystem(): System {
  return { platform: process.platform, env: process.env, home: os.homedir() };
}

/** DIGGA_DUMPS_DIR first, then the folder the user chose in the desktop app, then the default. */
function resolveDumpsDir(
  options: PathOptions,
  library: { dataDir: string; dumpsFolderFile: string; cacheDir: string },
): { dir: string; source: DumpsDirSource } {
  if (options.dumpsDir !== undefined)
    return { dir: path.resolve(options.dumpsDir), source: "environment" };
  const chosen = readChosenDumpsDir(library.dumpsFolderFile);
  if (chosen !== null) return { dir: chosen, source: "chosen" };
  // A library placed by hand keeps its dumps with it, so a throwaway one never touches the cache.
  const dir =
    options.dataDir === undefined
      ? path.join(library.cacheDir, "dumps")
      : path.join(library.dataDir, "dumps");
  return { dir, source: "default" };
}

const ChosenDumpsDirSchema = z.object({
  dumpsDir: z.string().refine((dir) => path.isAbsolute(dir)),
});

/** The folder dumps-folder.json names; a missing, unreadable or invalid file is no choice. */
function readChosenDumpsDir(file: string): string | null {
  let saved: unknown;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const parsed = ChosenDumpsDirSchema.safeParse(saved);
  return parsed.success ? parsed.data.dumpsDir : null;
}

/**
 * The per-user folders, named as Electron names userData so the packaged app opens the same
 * library: Application Support and Caches on macOS, APPDATA and LOCALAPPDATA on Windows, the
 * XDG config and cache folders elsewhere.
 */
export function appFolders(system: System): AppFolders {
  const { platform, env, home } = system;
  if (platform === "darwin") {
    const library = path.posix.join(home, "Library");
    return {
      data: path.posix.join(library, "Application Support", APP_NAME),
      cache: path.posix.join(library, "Caches", APP_NAME),
    };
  }
  if (platform === "win32") {
    const roaming = nonEmpty(env.APPDATA) ?? path.win32.join(home, "AppData", "Roaming");
    const local = nonEmpty(env.LOCALAPPDATA) ?? path.win32.join(home, "AppData", "Local");
    return {
      data: path.win32.join(roaming, APP_NAME),
      cache: path.win32.join(local, APP_NAME, "Cache"),
    };
  }
  const config = nonEmpty(env.XDG_CONFIG_HOME) ?? path.posix.join(home, ".config");
  const cache = nonEmpty(env.XDG_CACHE_HOME) ?? path.posix.join(home, ".cache");
  return { data: path.posix.join(config, APP_NAME), cache: path.posix.join(cache, APP_NAME) };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

export function resolveDumpFile(paths: Paths, file: string): string {
  if (file === "-" || path.isAbsolute(file)) return file;
  return path.resolve(paths.dumpsDir, file);
}

/** A schema upgrade keeps the pre-migration database separately from rotating daily copies. */
export function migrationBackupFile(dbFile: string, version: number): string {
  return path.join(path.dirname(dbFile), "backups", `before-migration-${version}.sqlite`);
}
