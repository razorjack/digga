import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../server/config-file.ts";
import { type Db, openDb } from "../server/db/db.ts";
import { createDiscogsClient } from "../server/discogs/client.ts";
import { createLogger, type LogLevel } from "../server/logger.ts";
import { resolvePaths } from "../server/paths.ts";
import { createSecrets } from "../server/secrets.ts";

export type Runtime = ReturnType<typeof boot>;

export function boot() {
  loadDotEnv();
  const paths = resolvePaths({
    dataDir: fromEnvironment("DIGGA_DATA_DIR"),
    dumpsDir: fromEnvironment("DIGGA_DUMPS_DIR"),
    configFile: fromEnvironment("DIGGA_CONFIG_FILE"),
  });
  const config = loadConfig(paths.configFile);
  const secrets = createSecrets({ envFile: paths.secretsFile });
  const level = (process.env.DIGGA_LOG_LEVEL as LogLevel | undefined) ?? "info";
  const logger = createLogger({ level });
  return { paths, config, secrets, logger };
}

/** A .env in the folder digga runs from adds to the environment; variables already set win. */
function loadDotEnv(): void {
  const file = path.join(process.cwd(), ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function fromEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function discogsFor(runtime: Runtime) {
  return createDiscogsClient({
    token: runtime.secrets.getDiscogsToken(),
    logger: runtime.logger.child("discogs"),
  });
}

export async function withDatabase<Result>(
  runtime: Runtime,
  run: (db: Db) => Promise<Result> | Result,
): Promise<Result> {
  const db = openDb(runtime.paths.dbFile);
  try {
    return await run(db);
  } finally {
    db.close();
  }
}
