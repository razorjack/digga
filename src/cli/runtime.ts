import { loadConfig } from "../server/config-file.ts";
import { type Db, openDb } from "../server/db/db.ts";
import { createDiscogsClient, JOB_RETRIES } from "../server/discogs/client.ts";
import { lockLibrary } from "../server/library-lock.ts";
import { createLogger } from "../server/logger.ts";
import { resolvePaths } from "../server/paths.ts";
import { createSecrets } from "../server/secrets.ts";
import { readLaunchEnvironment } from "./environment.ts";

export type Runtime = ReturnType<typeof boot>;

export function boot() {
  const environment = readLaunchEnvironment();
  const paths = resolvePaths(environment.paths);
  const config = loadConfig(paths.configFile);
  const secrets = createSecrets({ envFile: paths.secretsFile });
  const logger = createLogger({ level: environment.logLevel });
  return { paths, config, secrets, logger, ...environment.services };
}

export function discogsFor(runtime: Runtime) {
  return createDiscogsClient({
    token: runtime.secrets.getDiscogsToken(),
    retries: JOB_RETRIES,
    baseUrl: runtime.discogsApiUrl,
    logger: runtime.logger.child("discogs"),
  });
}

export async function withDatabase<Result>(
  runtime: Pick<Runtime, "paths">,
  run: (db: Db) => Promise<Result> | Result,
): Promise<Result> {
  const db = openDb(runtime.paths.dbFile);
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

/**
 * Runs a command that changes the library while this process holds it, so it refuses while the
 * server or another such command runs. `holder` names the command for that refusal.
 */
export async function withOwnedLibrary<Result>(
  runtime: Pick<Runtime, "paths">,
  holder: string,
  run: () => Promise<Result> | Result,
): Promise<Result> {
  const lock = lockLibrary(runtime.paths.lockFile, holder);
  try {
    return await run();
  } finally {
    lock.release();
  }
}

/** Runs a command that changes the library on its database, which it opens and migrates. */
export async function withOwnedDatabase<Result>(
  runtime: Pick<Runtime, "paths">,
  holder: string,
  run: (db: Db) => Promise<Result> | Result,
): Promise<Result> {
  return withOwnedLibrary(runtime, holder, () => withDatabase(runtime, run));
}
