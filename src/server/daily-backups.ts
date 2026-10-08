import type { BackupFailure } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import { backupDaily, localDay } from "./db/backup.ts";
import type { Db } from "./db/db.ts";
import { backUpDecisionsInWorker, type DecisionsBackupOptions } from "./decisions-backup.ts";
import type { Logger } from "./logger.ts";
import type { Paths } from "./paths.ts";

const CHECKPOINT_MS = 15 * 60 * 1000;

export interface DailyBackups {
  /** Stops checking and waits for a backup that is being written. */
  stop(): Promise<void>;
  /** The latest scheduled check that failed, until a later one or Back up now succeeds; for Settings. */
  failure(): BackupFailure | null;
  /** Back up now wrote every backup a check writes, so a check's failure no longer stands. */
  backedUp(): void;
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
  let failure: BackupFailure | null = null;
  let checking = false;
  const check = async () => {
    checking = true;
    try {
      const at = now();
      const failed = await writeDailyBackups(db, deps, at);
      failure = failed.length > 0 ? { at: at.toISOString(), message: failed.join("; ") } : null;
    } finally {
      checking = false;
    }
  };
  let latest = check();
  const timer = setInterval(() => {
    // A check that is still running stands in for this one.
    if (!checking) latest = check();
  }, schedule.everyMs ?? CHECKPOINT_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await latest;
      await writeCheckpoint(db, deps, now());
    },
    failure: () => failure,
    backedUp() {
      failure = null;
    },
  };
}

/**
 * The day's decisions backup and database copy, which reads a consistent snapshot, then a
 * checkpoint. Each daily backup skips a day that has one, and one failing does not stop the other.
 * Returns what failed.
 */
async function writeDailyBackups(db: Db, deps: BackupDeps, now: Date): Promise<string[]> {
  const { logger } = deps;
  const options = backupOptions(deps, now);

  const failures = await Promise.all([
    attempt(logger, "the daily decisions backup", async () => {
      const task = { backup: "daily", options } as const;
      const backup = await backUpDecisionsInWorker(db, deps.paths.dbFile, task, logger);
      if (backup) logger.info(`backed up your decisions to ${backup.file}`);
    }),
    attempt(logger, "the daily database backup", async () => {
      const backup = await backupDaily(db, options);
      if (backup) logger.info(`backed up the database to ${backup.file}`);
    }),
  ]);
  failures.push(await writeCheckpoint(db, deps, now));
  return failures.filter((failure) => failure !== null);
}

function writeCheckpoint(db: Db, deps: BackupDeps, now: Date): Promise<string | null> {
  const task = { backup: "checkpoint", options: backupOptions(deps, now) } as const;
  return attempt(deps.logger, "the decisions checkpoint", () =>
    backUpDecisionsInWorker(db, deps.paths.dbFile, task, deps.logger),
  );
}

/** Runs one backup; a failure is logged and returned as a sentence. */
async function attempt(
  logger: Logger,
  backup: string,
  write: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await write();
    return null;
  } catch (error) {
    logger.warn(`${backup} failed`, error);
    return `${backup} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function backupOptions(deps: BackupDeps, now: Date): DecisionsBackupOptions {
  return { dir: deps.paths.backupsDir, day: localDay(now), now, config: deps.getConfig?.() };
}
