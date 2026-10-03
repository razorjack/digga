import type { Config } from "../shared/config.ts";
import { backupDaily, localDay } from "./db/backup.ts";
import type { Db } from "./db/db.ts";
import {
  backupDecisionsDaily,
  checkpointDecisions,
  type DecisionsBackupOptions,
} from "./decisions-backup.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";

const CHECKPOINT_MS = 15 * 60 * 1000;

export interface DailyBackups {
  /** Stops checking and waits for a backup that is being written. */
  stop(): Promise<void>;
}

interface BackupDeps {
  paths: Paths;
  logger: Logger;
  /** The settings saved with each decisions backup; read on every write so edits are included. */
  getConfig?: () => Config;
}

/**
 * Writes the day's backups now and checks again every fifteen minutes, so a server left running
 * for days backs up every day. Each check also writes a checkpoint when personal data changed.
 */
export function startDailyBackups(
  db: Db,
  deps: BackupDeps,
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
 * The day's decisions backup and database copy, which reads a consistent snapshot, then a
 * checkpoint. Each daily backup skips a day that has one, and one failing does not stop the other.
 */
async function writeDailyBackups(db: Db, deps: BackupDeps, now: Date): Promise<void> {
  const { logger } = deps;
  const options = backupOptions(deps, now);

  const decisions = backupDecisionsDaily(db, options)
    .then((backup) => {
      if (backup) logger.info(`backed up your decisions to ${backup.file}`);
    })
    .catch((error: unknown) => logger.warn("the daily decisions backup failed", error));
  const database = backupDaily(db, options)
    .then((backup) => {
      if (backup) logger.info(`backed up the database to ${backup.file}`);
    })
    .catch((error: unknown) => logger.warn("the daily database backup failed", error));
  await Promise.all([decisions, database]);

  await writeCheckpoint(db, deps, now);
}

async function writeCheckpoint(db: Db, deps: BackupDeps, now: Date): Promise<void> {
  try {
    await checkpointDecisions(db, backupOptions(deps, now));
  } catch (error) {
    deps.logger.warn("the decisions checkpoint failed", error);
  }
}

function backupOptions(deps: BackupDeps, now: Date): DecisionsBackupOptions {
  return { dir: deps.paths.backupsDir, day: localDay(now), now, config: deps.getConfig?.() };
}
