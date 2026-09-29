import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { backupDaily, listBackups, localDay, writeBackup } from "../src/server/db/backup.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
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

  it("backs up when the server opens its own database", async () => {
    const paths = resolvePaths({ baseDir: path.join(tmp, "own") });
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
  });
});
