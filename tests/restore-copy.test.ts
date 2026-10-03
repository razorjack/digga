import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { writeBackup } from "../src/server/db/backup.ts";
import {
  applyMigrations,
  getMeta,
  listMigrations,
  newestSchemaVersion,
  openDb,
} from "../src/server/db/db.ts";
import { restoreDatabaseCopy } from "../src/server/db/restore-copy.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { type Paths, resolvePaths } from "../src/server/paths.ts";

const NOW = new Date(2026, 9, 3, 14, 5, 9);

let tmp: string;
let paths: Paths;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-restore-copy-"));
  paths = resolvePaths({ dataDir: path.join(tmp, "library") });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("restoring a database copy", () => {
  it("replaces a database whose -wal holds newer writes, and keeps that database", async () => {
    const copy = await libraryWithLogAfterCopy();
    expect(fs.statSync(`${paths.dbFile}-wal`).size).toBeGreaterThan(0);

    const restored = restoreDatabaseCopy(copy, paths, NOW);

    const kept = path.join(paths.backupsDir, "before-restore-2026-10-03-140509.sqlite");
    expect(restored).toEqual({
      file: copy,
      copyVersion: newestSchemaVersion(),
      schemaVersion: newestSchemaVersion(),
      previous: kept,
    });
    expect(fs.readdirSync(paths.dataDir).sort()).toEqual(["backups", "digga.sqlite"]);
    expect(fs.readdirSync(paths.backupsDir).sort()).toEqual([
      "before-restore-2026-10-03-140509.sqlite",
      "digga-2026-10-01.sqlite",
    ]);
    expect(verdictIn(paths.dbFile, "m:501")?.status).toBe("accepted");
    expect(verdictIn(kept, "m:501")?.status).toBe("maybe");
  });

  it("migrates a copy an older Digga wrote, into a library without a database", () => {
    const copy = olderCopy(10);

    const restored = restoreDatabaseCopy(copy, paths, NOW);

    expect(restored).toMatchObject({
      copyVersion: 10,
      schemaVersion: newestSchemaVersion(),
      previous: null,
    });
    const db = openDb(paths.dbFile, { readonly: true });
    expect(Number(getMeta(db, "schema_version"))).toBe(newestSchemaVersion());
    expect(getVerdict(db, "r:1")?.status).toBe("snoozed");
    db.close();
  });

  it("refuses a file that is not a Digga database, or one a newer Digga wrote", () => {
    const library = openDb(paths.dbFile);
    upsertVerdict(library, { key: "m:501", status: "rejected", source: "triage" });
    library.close();
    const text = path.join(tmp, "notes.sqlite");
    fs.writeFileSync(text, "not a database\n".repeat(100));
    const foreign = path.join(tmp, "foreign.sqlite");
    const other = openDb(foreign, { foreign: true });
    other.exec("CREATE TABLE things (name TEXT)");
    other.close();
    const newer = path.join(tmp, "newer.sqlite");
    const future = openDb(newer);
    future.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run();
    future.close();

    expect(() => restoreDatabaseCopy(text, paths, NOW)).toThrow(`${text} is not a Digga database`);
    expect(() => restoreDatabaseCopy(foreign, paths, NOW)).toThrow("is not a Digga database");
    expect(() => restoreDatabaseCopy(newer, paths, NOW)).toThrow(
      "written by a newer Digga (schema version 999)",
    );
    expect(fs.readdirSync(paths.dataDir)).toEqual(["digga.sqlite"]);
    expect(verdictIn(paths.dbFile, "m:501")?.status).toBe("rejected");
  });
});

/**
 * A daily copy, and a library whose later writes are only in its -wal file, as a process that
 * ended without closing the database leaves it.
 */
async function libraryWithLogAfterCopy(): Promise<string> {
  const live = openDb(path.join(tmp, "live.sqlite"));
  live.pragma("wal_autocheckpoint = 0");
  upsertVerdict(live, { key: "m:501", status: "accepted", source: "triage" });
  const copy = await writeBackup(live, { dir: paths.backupsDir, day: "2026-10-01" });
  upsertVerdict(live, { key: "m:501", status: "maybe", source: "triage" });

  for (const suffix of ["", "-wal", "-shm"])
    fs.copyFileSync(`${live.name}${suffix}`, `${paths.dbFile}${suffix}`);
  live.close();
  return copy.file;
}

/** A database at an older schema version, with a verdict. */
function olderCopy(version: number): string {
  const migrations = path.join(tmp, "old-migrations");
  fs.mkdirSync(migrations);
  for (const migration of listMigrations().filter((item) => item.version <= version))
    fs.copyFileSync(migration.file, path.join(migrations, migration.name));
  const file = path.join(tmp, `old-${version}.sqlite`);
  const old = openDb(file, { foreign: true });
  applyMigrations(old, migrations);
  // Written as that schema stores a verdict, which this version's writers no longer match.
  old
    .prepare(
      "INSERT INTO verdicts (key, status, source, decided_at) VALUES ('r:1', 'snoozed', 'triage', ?)",
    )
    .run("2026-09-01T10:00:00.000Z");
  old.close();
  return file;
}

function verdictIn(file: string, key: string) {
  const db = openDb(file, { readonly: true });
  try {
    return getVerdict(db, key);
  } finally {
    db.close();
  }
}
