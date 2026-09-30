import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.ts";

/** Daily copies kept in the backups directory; older ones are deleted. */
export const BACKUPS_KEPT = 2;

const BACKUP_FILE = /^digga-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export interface BackupFile {
  file: string;
  /** Local day the copy was taken, YYYY-MM-DD. */
  day: string;
  bytes: number;
}

export interface BackupOptions {
  dir: string;
  /** Local day of the copy, YYYY-MM-DD; see localDay(). */
  day: string;
  keep?: number;
}

/** Copies the database unless a copy for the day exists. Returns the new copy, or null. */
export async function backupDaily(db: Db, options: BackupOptions): Promise<BackupFile | null> {
  if (fs.existsSync(backupPath(options.dir, options.day))) return null;
  return writeBackup(db, options);
}

/** Copies the database for the day, replacing an earlier copy of the same day. */
export async function writeBackup(db: Db, options: BackupOptions): Promise<BackupFile> {
  const file = backupPath(options.dir, options.day);
  // A copy interrupted halfway must not count as the day's backup.
  const partial = `${file}.partial`;
  fs.mkdirSync(options.dir, { recursive: true });
  await db.backup(partial);
  fs.renameSync(partial, file);
  pruneBackups(options.dir, options.keep ?? BACKUPS_KEPT);
  return { file, day: options.day, bytes: fs.statSync(file).size };
}

/** Database copies in the directory, newest first. */
export function listBackups(dir: string): BackupFile[] {
  return listDatedFiles(dir, BACKUP_FILE);
}

/** Files in the directory whose name matches the pattern, whose first group is the day; newest first. */
export function listDatedFiles(dir: string, pattern: RegExp): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  const backups: BackupFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const day = pattern.exec(name)?.[1];
    if (!day) continue;
    const file = path.join(dir, name);
    backups.push({ file, day, bytes: fs.statSync(file).size });
  }
  return backups.sort((left, right) => right.day.localeCompare(left.day));
}

/** YYYY-MM-DD in local time, so a backup belongs to the day the user sees. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function backupPath(dir: string, day: string): string {
  return path.join(dir, `digga-${day}.sqlite`);
}

function pruneBackups(dir: string, keep: number): void {
  for (const backup of listBackups(dir).slice(keep)) fs.rmSync(backup.file, { force: true });
}
