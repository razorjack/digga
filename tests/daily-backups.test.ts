import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { startDailyBackups } from "../src/server/daily-backups.ts";
import { listBackups } from "../src/server/db/backup.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { listDecisionsBackups } from "../src/server/decisions-backup.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { silentLogger } from "./helpers.ts";

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
});
