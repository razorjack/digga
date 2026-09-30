import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Paths {
  /** The library: database, backups, config, saved token, temp files. */
  dataDir: string;
  dbFile: string;
  configFile: string;
  dumpsDir: string;
  /** Daily copies of the database, written when the server starts. */
  backupsDir: string;
  tempDir: string;
  /** Built frontend bundle served by Hono in production. */
  distDir: string;
  /** The Discogs token Settings saves, in .env format; read by secrets.ts. */
  secretsFile: string;
}

export interface PathOptions {
  /** Where the library lives; by default the per-user app folder (see appFolders). */
  dataDir?: string;
  /** By default "dumps" in a dataDir given here, else in the OS cache folder. */
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
export function resolvePaths(options: PathOptions = {}): Paths {
  const folders = appFolders({ platform: process.platform, env: process.env, home: os.homedir() });
  const dataDir = path.resolve(options.dataDir ?? folders.data);
  // A library placed by hand keeps its dumps with it, so a throwaway one never touches the cache.
  const defaultDumpsDir =
    options.dataDir === undefined ? path.join(folders.cache, "dumps") : path.join(dataDir, "dumps");
  return {
    dataDir,
    dbFile: path.join(dataDir, "digga.sqlite"),
    configFile: path.resolve(options.configFile ?? path.join(dataDir, "digga.config.json")),
    dumpsDir: path.resolve(options.dumpsDir ?? defaultDumpsDir),
    backupsDir: path.join(dataDir, "backups"),
    tempDir: path.join(dataDir, "tmp"),
    distDir: path.resolve(options.distDir ?? DEFAULT_DIST_DIR),
    secretsFile: path.join(dataDir, "secrets.env"),
  };
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
