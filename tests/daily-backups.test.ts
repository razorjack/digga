import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { startDailyBackups } from "../src/server/daily-backups.ts";
import { listBackups } from "../src/server/db/backup.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import {
  listDecisionsBackups,
  listCheckpoints,
  readDecisionsBackup,
} from "../src/server/decisions-backup.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer } from "../src/server/server.ts";
import type { BackupsResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { silentLogger, testSecrets } from "./helpers.ts";

let tmp: string;
let db: Db;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-daily-"));
  db = openDb(path.join(tmp, "digga.sqlite"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("daily backups", () => {
  it("checkpoints changed decisions during the day and once more at shutdown", async () => {
    const paths = resolvePaths({ dataDir: tmp });
    // Each check is a minute later, so each checkpoint has a name of its own.
    let minutes = 0;
    const now = () => new Date(Date.UTC(2026, 9, 3, 10, minutes++));
    const backups = startDailyBackups(db, { paths, logger: silentLogger }, { everyMs: 10, now });
    await expect.poll(() => listCheckpoints(paths.backupsDir).length).toBe(1);
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });
    await expect.poll(() => listCheckpoints(paths.backupsDir).length).toBe(2);
    upsertVerdict(db, { key: "m:502", status: "rejected", source: "triage" });
    await backups.stop();
    const latest = listCheckpoints(paths.backupsDir)[0]!;
    expect(readDecisionsBackup(latest.file).verdicts.map((verdict) => verdict.key)).toEqual([
      "m:501",
      "m:502",
    ]);
    expect(listBackups(paths.backupsDir)).toHaveLength(1);
  });

  it("back up again when a new day comes while the server runs, and stop with it", async () => {
    const paths = resolvePaths({ dataDir: tmp });
    const days = () => ({
      database: listBackups(paths.backupsDir).map((backup) => backup.day),
      decisions: listDecisionsBackups(paths.backupsDir).map((backup) => backup.day),
    });
    let today = new Date(2026, 8, 30, 23, 30);
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });

    const backups = startDailyBackups(
      db,
      { paths, logger: silentLogger },
      { everyMs: 10, now: () => today },
    );
    await expect.poll(days).toEqual({ database: ["2026-09-30"], decisions: ["2026-09-30"] });

    upsertVerdict(db, { key: "m:506", status: "rejected", source: "triage" });
    today = new Date(2026, 9, 1, 0, 30);
    await expect
      .poll(days)
      .toEqual({ database: ["2026-10-01", "2026-09-30"], decisions: ["2026-10-01", "2026-09-30"] });

    await backups.stop();
    today = new Date(2026, 9, 2, 0, 30);
    await wait(50);
    expect(days().database).toEqual(["2026-10-01", "2026-09-30"]);
  });

  it("reports a failed check until a later one succeeds", async () => {
    const paths = resolvePaths({ dataDir: tmp });
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });
    // A file where the backups folder belongs makes every backup fail.
    fs.writeFileSync(paths.backupsDir, "");
    const backups = startDailyBackups(db, { paths, logger: silentLogger }, { everyMs: 10 });

    await expect
      .poll(() => backups.failure()?.message ?? "")
      .toMatch(
        /^the daily decisions backup failed: .*; the daily database backup failed: .*; the decisions checkpoint failed: /,
      );
    fs.rmSync(paths.backupsDir);
    // A check that succeeds copies the database, which can outlast poll's 1 s on a busy machine.
    await expect.poll(() => backups.failure(), { timeout: 5000 }).toBeNull();
    await backups.stop();
  });

  it("forgets a failed check once Back up now has written every backup", async () => {
    db.close();
    const paths = resolvePaths({ dataDir: tmp });
    fs.mkdirSync(paths.dataDir, { recursive: true });
    // A file where the backups folder belongs makes the start's check fail.
    fs.writeFileSync(paths.backupsDir, "");
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      persistConfig: false,
    });
    const read = async (method: "GET" | "POST") =>
      (await (await server.app.request("/api/backups", { method })).json()) as BackupsResponse;
    try {
      await expect.poll(async () => (await read("GET")).failure).not.toBeNull();
      fs.rmSync(paths.backupsDir);

      const backedUp = await read("POST");

      expect(backedUp.failure).toBeNull();
      expect(backedUp.decisions.backups).toHaveLength(1);
      expect((await read("GET")).failure).toBeNull();
    } finally {
      await server.stop();
      db = openDb(":memory:");
    }
  });
});
