import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { backupDaily, listBackups, localDay, writeBackup } from "../src/server/db/backup.ts";
import { type Db, openDb, applyMigrations, listMigrations, getMeta } from "../src/server/db/db.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { listDecisionsBackups } from "../src/server/decisions-backup.ts";
import { createServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { silentLogger, testSecrets } from "./helpers.ts";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-backup-"));
  db = openDb(path.join(tmp, "digga.sqlite"));
  upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", notes: "keep" });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("database backups", () => {
  it("copies the old schema and decisions before applying new migrations", () => {
    const migrations = path.join(tmp, "old-migrations");
    fs.mkdirSync(migrations);
    for (const migration of listMigrations().filter((item) => item.version <= 10))
      fs.copyFileSync(migration.file, path.join(migrations, migration.name));
    const file = path.join(tmp, "old.sqlite");
    const old = openDb(file, { foreign: true });
    applyMigrations(old, migrations);
    upsertVerdict(old, {
      key: "r:1",
      status: "accepted",
      source: "triage",
      notes: "before upgrade",
    });
    old.close();
    const upgraded = openDb(file);
    expect(Number(getMeta(upgraded, "schema_version"))).toBeGreaterThan(10);
    upgraded.close();
    const snapshot = openDb(path.join(tmp, "backups", "before-migration-10.sqlite"), {
      readonly: true,
    });
    expect(getMeta(snapshot, "schema_version")).toBe("10");
    expect(getVerdict(snapshot, "r:1")?.notes).toBe("before upgrade");
    snapshot.close();
  });

  it("copies the database once per day, as a database that opens", async () => {
    const dir = path.join(tmp, "backups");
    const first = await backupDaily(db, { dir, day: "2026-09-28" });
    expect(first?.file).toBe(path.join(dir, "digga-2026-09-28.sqlite"));
    expect(await backupDaily(db, { dir, day: "2026-09-28" })).toBeNull();

    const copy = openDb(first!.file, { readonly: true });
    expect(getVerdict(copy, "m:501")).toMatchObject({ status: "accepted", notes: "keep" });
    copy.close();
  });

  it("keeps the newest copies and ignores other files", async () => {
    const dir = path.join(tmp, "backups");
    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"])
      await writeBackup(db, { dir, day, keep: 3 });
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    fs.writeFileSync(path.join(dir, "digga-2026-09-05.sqlite.partial"), "");
    expect(listBackups(dir).map((backup) => backup.day)).toEqual([
      "2026-09-04",
      "2026-09-03",
      "2026-09-02",
    ]);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });

  it("replaces the day's copy when asked to back up again", async () => {
    const dir = path.join(tmp, "backups");
    await writeBackup(db, { dir, day: "2026-09-28" });
    upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage" });
    await writeBackup(db, { dir, day: "2026-09-28" });
    const copy = openDb(path.join(dir, "digga-2026-09-28.sqlite"), { readonly: true });
    expect(getVerdict(copy, "m:501")?.status).toBe("rejected");
    copy.close();
  });

  it("names days in local time", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("backs up the database and the decisions when the server opens its own database", async () => {
    const paths = resolvePaths({ dataDir: path.join(tmp, "own") });
    const own = openDb(paths.dbFile);
    upsertVerdict(own, { key: "m:501", status: "accepted", source: "triage" });
    own.close();
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
    });
    await server.stop();
    expect(listBackups(paths.backupsDir).map((backup) => backup.day)).toEqual([
      localDay(new Date()),
    ]);
    expect(listDecisionsBackups(paths.backupsDir).map((backup) => backup.day)).toEqual([
      localDay(new Date()),
    ]);
  });
});
