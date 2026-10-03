import BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrationBackupFile } from "../paths.ts";

/**
 * The only module that imports better-sqlite3. Everything else receives a Db.
 * Electron needs @electron/rebuild for this native module; keeping the import
 * here means that is the only place to adapt.
 */
export type Db = BetterSqlite3.Database;
export type Statement<Params extends unknown[] | Record<string, unknown> = unknown[]> =
  BetterSqlite3.Statement<Params>;

export interface OpenOptions {
  readonly?: boolean;
  /** Skip WAL and migrations (used for foreign databases such as browser history). */
  foreign?: boolean;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

export function openDb(file: string, options: OpenOptions = {}): Db {
  if (file !== ":memory:" && !options.readonly)
    fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new BetterSqlite3(file, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });
  if (options.foreign) return db;
  if (file !== ":memory:" && !options.readonly) db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  if (options.readonly) return db;

  try {
    backupBeforeMigration(db, file);
    applyMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function listMigrations(
  dir: string = MIGRATIONS_DIR,
): { version: number; name: string; file: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({
      version: Number.parseInt(name.slice(0, 4), 10),
      name,
      file: path.join(dir, name),
    }));
}

/**
 * Applies numbered .sql migrations that are newer than meta.schema_version. Refuses a library
 * that a newer Digga migrated, since this version would write rows that one does not expect.
 */
export function applyMigrations(db: Db, dir: string = MIGRATIONS_DIR): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  const migrations = listMigrations(dir);
  const current = getMeta(db, "schema_version");
  let version = current ? Number.parseInt(current, 10) : 0;
  const known = migrations.at(-1)?.version ?? 0;
  if (version > known)
    throw new Error(
      `This library has schema version ${version}, newer than this Digga knows (${known}). Use the newer Digga that wrote it.`,
    );

  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    const sql = fs.readFileSync(migration.file, "utf8");
    db.transaction(() => {
      db.exec(sql);
      setMeta(db, "schema_version", String(migration.version));
    })();
    version = migration.version;
    applied.push(migration.version);
  }
  return applied;
}

export function getMeta(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? undefined;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Copies a database with pending migrations to `before-migration-<version>.sqlite`, apart from the
 * rotating daily copies. A new database has nothing to keep.
 */
function backupBeforeMigration(db: Db, file: string): void {
  if (file === ":memory:") return;
  const version = savedSchemaVersion(db);
  const pending = listMigrations().some((migration) => migration.version > version);
  if (version === 0 || !pending) return;

  const backup = migrationBackupFile(file, version);
  const partial = `${backup}.partial`;
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.rmSync(partial, { force: true });
  // VACUUM INTO writes a consistent snapshot that includes the WAL contents.
  db.prepare("VACUUM INTO ?").run(partial);
  fs.renameSync(partial, backup);
}

/** The applied schema version; 0 for a database without the meta table. */
function savedSchemaVersion(db: Db): number {
  const hasMeta = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!hasMeta) return 0;
  return Number(getMeta(db, "schema_version") ?? 0);
}
