import type { Config } from "../shared/config.ts";
import { backupDaily, localDay } from "./db/backup.ts";
import type { Db } from "./db/db.ts";
import { backupDecisionsDaily } from "./decisions-backup.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";

const HOUR_MS = 60 * 60 * 1000;

export interface DailyBackups {
  /** Stops checking and waits for a backup that is being written. */
  stop(): Promise<void>;
}

/**
 * Writes the day's backups now and checks again every hour, so a server left running for days
 * backs up every day. Each check after the day's backups exist costs two file lookups.
 */
export function startDailyBackups(
  db: Db,
  deps: { paths: Paths; logger: Logger; getConfig?: () => Config },
  schedule: { everyMs?: number; now?: () => Date } = {},
): DailyBackups {
  const now = schedule.now ?? (() => new Date());
  let latest = writeDailyBackups(db, deps, now());
  const timer = setInterval(() => {
    latest = latest.then(() => writeDailyBackups(db, deps, now()));
  }, schedule.everyMs ?? HOUR_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await latest;
    },
  };
}

/**
 * The day's decisions backup and database copy, which reads a consistent snapshot. Each skips a
 * day that has one, and one failing does not stop the other.
 */
async function writeDailyBackups(
  db: Db,
  deps: { paths: Paths; logger: Logger; getConfig?: () => Config },
  now: Date,
): Promise<void> {
  const { paths, logger } = deps;
  const day = localDay(now);
  const decisions = backupDecisionsDaily(db, {
    dir: paths.backupsDir,
    day,
    now,
    config: deps.getConfig?.(),
  })
    .then((backup) => {
      if (backup) logger.info(`backed up your decisions to ${backup.file}`);
    })
    .catch((error: unknown) => logger.warn("the daily decisions backup failed", error));
  const database = backupDaily(db, { dir: paths.backupsDir, day })
    .then((backup) => {
      if (backup) logger.info(`backed up the database to ${backup.file}`);
    })
    .catch((error: unknown) => logger.warn("the daily database backup failed", error));
  await Promise.all([decisions, database]);
}
