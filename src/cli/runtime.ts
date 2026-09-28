import { loadConfig } from "../server/config-file.ts";
import { type Db, openDb } from "../server/db/db.ts";
import { createDiscogsClient } from "../server/discogs/client.ts";
import { createLogger, type LogLevel } from "../server/logger.ts";
import { resolvePaths } from "../server/paths.ts";
import { createSecrets } from "../server/secrets.ts";

export type Runtime = ReturnType<typeof boot>;

export function boot() {
  const paths = resolvePaths({ baseDir: process.cwd() });
  const config = loadConfig(paths.configFile, paths.configExampleFile);
  const secrets = createSecrets({ envFile: paths.envFile });
  const level = (process.env.DIGGA_LOG_LEVEL as LogLevel | undefined) ?? "info";
  const logger = createLogger({ level });
  return { paths, config, secrets, logger };
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
