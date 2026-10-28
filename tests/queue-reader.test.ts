import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { catalogueVersion } from "../src/server/db/catalogue-memo.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { type QueueReader, workerQueueReader } from "../src/server/queue/reader.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { loadDump } from "../src/server/dump/load.ts";
import { FIXTURE_GZ, filters } from "./helpers.ts";

describe("the queue reader's worker", () => {
  let directory: string;
  let db: Db;
  let reader: QueueReader;
  const query = { filters: filters({}), strategy: "label_sweep" as const, limit: 10 };
  const ids = async () => (await reader.queue(query)).items.map((item) => item.id);

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "digga-reader-"));
    const file = path.join(directory, "digga.sqlite");
    db = openDb(file);
    await loadDump(db, { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null });
    reader = workerQueueReader(file, () => catalogueVersion(db));
  });

  afterEach(async () => {
    await reader.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reads the queue and the stats the server's connection wrote", async () => {
    expect(await reader.queue(query)).toEqual({
      items: [expect.objectContaining({ id: 1006 }), expect.objectContaining({ id: 1001 })],
      remaining: 2,
    });
    upsertVerdict(db, { key: "m:506", status: "rejected", source: "triage" });
    expect(await ids()).toEqual([1001]);
    const stats = await reader.stats({ ...DEFAULT_CONFIG, filters: query.filters }, null);
    expect([stats.remaining, stats.verdicts.rejected]).toEqual([1, 1]);
  });

  it("reads the catalogue again after the server's connection changes it", async () => {
    expect(await ids()).toEqual([1006, 1001]);
    db.prepare("UPDATE releases SET year = 1997 WHERE id = 1006").run();
    expect(await ids()).toEqual([1001]);
  });

  it("rejects a read that fails, and goes on reading after it and after closing", async () => {
    await expect(reader.queue({ ...query, strategy: "unknown" as never })).rejects.toThrow();
    expect(await ids()).toEqual([1006, 1001]);
    await reader.close();
    expect(await ids()).toEqual([1006, 1001]);
  });
});
