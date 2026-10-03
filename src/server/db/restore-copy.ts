import fs from "node:fs";
import path from "node:path";
import type { Paths } from "../paths.ts";
import { localDay } from "./backup.ts";
import { copyDatabase, getMeta, newestSchemaVersion, openDb, readSchemaVersion } from "./db.ts";

export interface RestoredDatabase {
  /** The database copy that replaced the library's database. */
  file: string;
  /** The copy's schema version, before migrations brought it up to `schemaVersion`. */
  copyVersion: number;
  schemaVersion: number;
  /** Where the database it replaced was kept; null when the library had none. */
  previous: string | null;
}

/**
 * Replaces the library's database with a copy, such as a daily `digga-YYYY-MM-DD.sqlite` or a
 * `before-migration-<version>.sqlite`, after keeping the database it replaces in the backups
 * folder. The caller holds the library lock. The copy is checked on a staged duplicate beside the
 * database, so opening it leaves no -wal and -shm files in the backups folder; a refused copy
 * leaves no staged file either.
 */
export function restoreDatabaseCopy(
  copy: string,
  library: Pick<Paths, "dbFile" | "backupsDir">,
  now: Date,
): RestoredDatabase {
  const staged = `${library.dbFile}.restoring`;
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.copyFileSync(copy, staged);
  try {
    const copyVersion = checkCopyVersion(staged, copy);
    const previous = keepDatabase(library, now);
    replaceDatabase(library.dbFile, staged);
    const schemaVersion = migrateDatabase(library.dbFile);
    return { file: copy, copyVersion, schemaVersion, previous };
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

/** The staged copy's schema version; throws when it is not a database this Digga can open. */
function checkCopyVersion(staged: string, copy: string): number {
  const version = readSchemaVersion(staged);
  if (version === null) throw new Error(`${copy} is not a Digga database.`);
  const newest = newestSchemaVersion();
  if (version > newest)
    throw new Error(
      `${copy} was written by a newer Digga (schema version ${version}); this version opens schema versions up to ${newest}.`,
    );
  return version;
}

/** Copies the library's database, committed WAL content included; null when there is none. */
function keepDatabase(library: Pick<Paths, "dbFile" | "backupsDir">, now: Date): string | null {
  if (!fs.existsSync(library.dbFile)) return null;
  const kept = keptDatabaseFile(library.backupsDir, now);
  // No migrations: a database a newer Digga wrote is kept as it is.
  const db = openDb(library.dbFile, { readonly: true, foreign: true });
  try {
    copyDatabase(db, kept);
  } finally {
    db.close();
  }
  return kept;
}

/** `before-restore-YYYY-MM-DD-HHMMSS.sqlite` in local time, a name daily rotation leaves alone. */
function keptDatabaseFile(backupsDir: string, now: Date): string {
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return path.join(backupsDir, `before-restore-${localDay(now)}-${time}.sqlite`);
}

/**
 * Moves the staged copy over the database. The replaced database's -wal and -shm files go first:
 * SQLite would apply that write-ahead log to the copy.
 */
function replaceDatabase(dbFile: string, staged: string): void {
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
  fs.renameSync(staged, dbFile);
}

/** Opens the restored database once, which applies the migrations it lacks; returns its version. */
function migrateDatabase(dbFile: string): number {
  const db = openDb(dbFile);
  try {
    return Number(getMeta(db, "schema_version"));
  } finally {
    db.close();
  }
}
