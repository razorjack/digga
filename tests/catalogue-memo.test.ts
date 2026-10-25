import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { rememberForCatalogue } from "../src/server/db/catalogue-memo.ts";
import { openDb } from "../src/server/db/db.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { countRemaining, queryQueue } from "../src/server/queue/query.ts";
import { filters, fixtureDb } from "./helpers.ts";

describe("rememberForCatalogue", () => {
  it("computes again after a write to the catalogue, and not after a verdict", async () => {
    const db = await fixtureDb();
    let computed = 0;
    const read = () => rememberForCatalogue(db, "test", () => (computed += 1));
    read();
    read();
    expect(computed).toBe(1);

    upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage" });
    db.prepare("UPDATE releases SET lowest_price = 9 WHERE id = 1001").run();
    read();
    expect(computed).toBe(1);

    db.prepare("UPDATE videos SET embeddable = 0 WHERE release_id = 1001").run();
    read();
    expect(computed).toBe(2);
    db.prepare("UPDATE releases SET year = 1997 WHERE id = 1001").run();
    read();
    expect(computed).toBe(3);
    db.close();
  });

  it("computes again after another connection commits", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digga-memo-"));
    const file = path.join(directory, "digga.sqlite");
    const db = openDb(file);
    const worker = openDb(file);
    let computed = 0;
    const read = () => rememberForCatalogue(db, "test", () => (computed += 1));
    try {
      read();
      worker.prepare("INSERT INTO meta (key, value) VALUES ('other', '1')").run();
      read();
      expect(computed).toBe(2);
    } finally {
      worker.close();
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps nothing computed inside a transaction, which may roll back", async () => {
    const db = await fixtureDb();
    let computed = 0;
    const read = () => rememberForCatalogue(db, "test", () => (computed += 1));
    db.transaction(() => {
      read();
      read();
    })();
    expect(computed).toBe(2);
    db.close();
  });
});

describe("the remembered queue", () => {
  it("leaves out a record decided after it was remembered", async () => {
    const db = await fixtureDb();
    const query = { filters: filters({}), strategy: "label_sweep" as const, limit: 10 };
    const before = queryQueue(db, query).map((item) => item.triageKey);
    upsertVerdict(db, { key: before[0]!, status: "rejected", source: "triage" });
    expect(queryQueue(db, query).map((item) => item.triageKey)).toEqual(before.slice(1));
    expect(countRemaining(db, query.filters)).toBe(before.length - 1);
    db.close();
  });

  it("finds a record of unknown year once a want puts its label on the coverage", async () => {
    const db = await fixtureDb();
    const query = { filters: filters({}), strategy: "label_sweep" as const, limit: 10 };
    const ids = () => queryQueue(db, query).map((item) => item.id);
    expect(ids()).toEqual([1006, 1001]);
    // The sampler 1003 has no year and shares Renegade Hardware with 1006.
    upsertVerdict(db, { key: "m:506", status: "accepted", source: "triage" });
    expect(ids()).toEqual([1001, 1003]);
    db.close();
  });
});
