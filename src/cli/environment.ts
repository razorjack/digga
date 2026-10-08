import fs from "node:fs";
import path from "node:path";
import { LOG_LEVELS, type LogLevel } from "../server/logger.ts";
import type { PathOptions } from "../server/paths.ts";
import type { CreateServerOptions } from "../server/server.ts";

/**
 * What the environment sets for a Digga process. The CLI and the Electron app's main process
 * both read it here, so they open the same library with the same services.
 */
export interface LaunchEnvironment {
  /** DIGGA_DATA_DIR, DIGGA_DUMPS_DIR and DIGGA_CONFIG_FILE. */
  paths: PathOptions;
  /** DIGGA_LOG_LEVEL, "info" by default. */
  logLevel: LogLevel;
  /**
   * Stand-ins for data.discogs.com, the Discogs API and YouTube's oEmbed, for rehearsals and the
   * end-to-end tests (tools/dev/fake-services.ts).
   */
  services: Pick<CreateServerOptions, "dataDumpsUrl" | "discogsApiUrl" | "youtubeOembedUrl">;
}

/** This process's environment, with a .env in the folder it runs from added; variables already set win. */
export function readLaunchEnvironment(): LaunchEnvironment {
  const file = path.join(process.cwd(), ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
  return launchEnvironment(process.env);
}

/**
 * DIGGA_E2E_HOLD=1, from the environment only: the Electron app waits at its start until the E2E
 * host has prepared it through the inspector (docs/e2e/ELECTRON.md#startup-order). A build without
 * the inspector cannot be prepared, so there the variable only stops the app.
 */
export function testHostHoldRequested(): boolean {
  return process.env.DIGGA_E2E_HOLD === "1";
}

export function launchEnvironment(env: Record<string, string | undefined>): LaunchEnvironment {
  const read = (name: string) => nonEmpty(env[name]);
  return {
    paths: {
      dataDir: read("DIGGA_DATA_DIR"),
      dumpsDir: read("DIGGA_DUMPS_DIR"),
      configFile: read("DIGGA_CONFIG_FILE"),
    },
    logLevel: parseLogLevel(read("DIGGA_LOG_LEVEL")),
    services: {
      dataDumpsUrl: read("DIGGA_DUMPS_URL"),
      discogsApiUrl: read("DIGGA_DISCOGS_API_URL"),
      youtubeOembedUrl: read("DIGGA_YOUTUBE_OEMBED_URL"),
    },
  };
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) return "info";
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (!level) throw new Error(`DIGGA_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  return level;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
