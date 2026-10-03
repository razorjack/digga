import type { Config } from "../shared/config.ts";
import { backupDaily, localDay } from "./db/backup.ts";
import type { Db } from "./db/db.ts";
import { backupDecisionsDaily, checkpointDecisions } from "./decisions-backup.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";

const CHECKPOINT_MS = 15 * 60 * 1000;

export interface DailyBackups {
  /** Stops checking and waits for a backup that is being written. */
  stop(): Promise<void>;
}

/**
 * Writes the day's backups now and checks again every fifteen minutes, so a server left running for days
 * backs up every day. Changed personal data gets an additional checkpoint on each check.
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
  }, schedule.everyMs ?? CHECKPOINT_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await latest;
      await writeCheckpoint(db, deps, now());
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
  await writeCheckpoint(db, deps, now);
}

async function writeCheckpoint(
  db: Db,
  deps: { paths: Paths; logger: Logger; getConfig?: () => Config },
  now: Date,
): Promise<void> {
  try {
    await checkpointDecisions(db, {
      dir: deps.paths.backupsDir,
      day: localDay(now),
      now,
      config: deps.getConfig?.(),
    });
  } catch (error) {
    deps.logger.warn("the decisions checkpoint failed", error);
  }
}
