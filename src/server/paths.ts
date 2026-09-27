import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Paths {
  /** Root for everything the app writes: database, dumps, temp files. */
  dataDir: string;
  dbFile: string;
  configFile: string;
  dumpsDir: string;
  tempDir: string;
  /** Built frontend bundle served by Hono in production. */
  distDir: string;
  /** Optional .env file read by secrets.ts. */
  envFile: string;
}

export interface PathOptions {
  /** Base directory for relative defaults. The CLI passes process.cwd(); Electron passes app.getPath('userData'). */
  baseDir: string;
  dataDir?: string;
  configFile?: string;
  distDir?: string;
  envFile?: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** dist/ lives two levels above src/server/. */
export const DEFAULT_DIST_DIR = path.resolve(MODULE_DIR, "..", "..", "dist");

/**
 * Resolves every filesystem location the app uses. This is the only module
 * that decides where user data lives; everything else receives a Paths object.
 */
export function resolvePaths(opts: PathOptions): Paths {
  const envDataDir = process.env.DIGGA_DATA_DIR;
  const envConfigFile = process.env.DIGGA_CONFIG_FILE;
  const dataDir = path.resolve(opts.dataDir ?? envDataDir ?? path.join(opts.baseDir, "data"));
  const configFile = path.resolve(
    opts.configFile ?? envConfigFile ?? path.join(opts.baseDir, "digga.config.json"),
  );
  return {
    dataDir,
    dbFile: path.join(dataDir, "digga.sqlite"),
    configFile,
    dumpsDir: path.join(dataDir, "dumps"),
    tempDir: path.join(dataDir, "tmp"),
    distDir: path.resolve(opts.distDir ?? DEFAULT_DIST_DIR),
    envFile: path.resolve(opts.envFile ?? path.join(opts.baseDir, ".env")),
  };
}
