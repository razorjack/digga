import { describe, expect, it } from "vite-plus/test";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { writeSnapshot } from "../src/server/db/releases.ts";
import {
  buildQueueSql,
  countRemaining,
  countUniverseKeys,
  queryQueue,
  representativeForKey,
} from "../src/server/queue/query.ts";
import { type Filters, withLabelExcluded } from "../src/shared/config.ts";
import { filters, fixtureDb } from "./helpers.ts";

describe("queue query", () => {
  it("groups by triage key, applies default filters and label sweep order", async () => {
    const db = await fixtureDb();
    const items = queryQueue(db, { filters: filters({}), strategy: "label_sweep", limit: 200 });
    expect(items.map((i) => [i.id, i.triageKey])).toEqual([
      [1006, "m:506"],
      [1001, "m:501"],
    ]);
    expect(items[1]).toMatchObject({
      videoCount: 2,
      labelName: "Renegade Hardware",
      catno: "RH 20",
      formatSummary: '2 x Vinyl (12", 33 ⅓ RPM)',
    });
    expect(countRemaining(db, filters({}))).toBe(2);
    expect(countUniverseKeys(db, null)).toBe(4);
    expect(countUniverseKeys(db, filters({}))).toBe(2);
    db.close();
  });

  it("year, unknown-year, format and country filters are query-time", async () => {
    const db = await fixtureDb();
    const withUnknown = queryQueue(db, {
      filters: filters({ includeUnknownYear: true }),
      strategy: "label_sweep",
      limit: 200,
    });
    expect(withUnknown.map((i) => i.id)).toEqual([1006, 1001, 1003]);
    const open = queryQueue(db, {
      filters: filters({ yearFrom: null, yearTo: null, formats: [] }),
      strategy: "label_sweep",
      limit: 200,
    });
    expect(open.map((i) => i.id)).toEqual([1004, 1006, 1001]);
    const cd = queryQueue(db, {
      filters: filters({ yearFrom: null, yearTo: null, formats: ["CD"] }),
      strategy: "label_sweep",
      limit: 200,
    });
    expect(cd.map((i) => i.id)).toEqual([1004]);
    const de = queryQueue(db, {
      filters: filters({ countries: ["Germany"] }),
      strategy: "label_sweep",
      limit: 200,
    });
    expect(de.map((i) => i.id)).toEqual([1002]);
    const styles = queryQueue(db, {
      filters: filters({ styles: ["Techstep"] }),
      strategy: "label_sweep",
      limit: 200,
    });
    expect(styles.map((i) => i.id)).toEqual([1001]);
    expect(
      queryQueue(db, { filters: filters({}), strategy: "label_sweep", limit: 1 }),
    ).toHaveLength(1);
    expect(
      queryQueue(db, { filters: filters({}), strategy: "label_sweep", limit: 5, offset: 1 }).map(
        (i) => i.id,
      ),
    ).toEqual([1001]);
    db.close();
  });

  it("skips records without an embeddable video when asked", async () => {
    const db = await fixtureDb();
    const f = filters({ skipWithoutVideos: true });
    const ids = () =>
      queryQueue(db, { filters: f, strategy: "label_sweep", limit: 200 }).map((i) => i.id);
    expect(ids()).toEqual([1006, 1001]);
    db.prepare("UPDATE videos SET embeddable = 0 WHERE release_id = 1006").run();
    expect(ids()).toEqual([1001]);
    expect(countRemaining(db, f)).toBe(1);
    expect(countRemaining(db, filters({}))).toBe(2);
    db.close();
  });

  it("leaves out labels and format descriptions", async () => {
    const db = await fixtureDb();
    const ids = (overrides: Partial<Filters>) =>
      queryQueue(db, { filters: filters(overrides), strategy: "label_sweep", limit: 10 }).map(
        (item) => item.id,
      );
    expect(ids({})).toEqual([1006, 1001]);
    expect(ids({ excludeLabels: ["renegade hardware"] })).toEqual([]);
    expect(ids({ excludeLabels: ["Moving Shadow"] })).toEqual([1006, 1001]);
    db.prepare("UPDATE releases SET label_name = 'Renegade Hardware (2)' WHERE id = 1006").run();
    expect(ids({ excludeLabels: ["Renegade Hardware"] })).toEqual([]);
    // The sweep now orders the renamed label after the original.
    expect(ids({ excludeLabels: ["Renegade"] })).toEqual([1001, 1006]);
    expect(ids({ excludeLabels: ["Renegade_Hardware"] })).toEqual([1001, 1006]);
    db.prepare("UPDATE releases SET label_name = 'Renegade Hardware' WHERE id = 1006").run();
    expect(ids({ includeDescriptions: ["45 RPM"] })).toEqual([1006]);
    expect(ids({ excludeDescriptions: ["45 RPM"] })).toEqual([1001]);
    expect(ids({ includeDescriptions: ['12"'], excludeDescriptions: ["Sampler"] })).toEqual([
      1006, 1001,
    ]);
    db.close();
  });

  it("adds and removes a label from the ones left out", () => {
    const hidden = withLabelExcluded(filters({ excludeLabels: ["Virgin"] }), "Moving Shadow", true);
    expect(hidden.excludeLabels).toEqual(["Virgin", "Moving Shadow"]);
    expect(withLabelExcluded(hidden, "Moving Shadow", true).excludeLabels).toHaveLength(2);
    expect(withLabelExcluded(hidden, "Virgin", false).excludeLabels).toEqual(["Moving Shadow"]);
  });

  it("counts videos of other pressings when skipping records without one", async () => {
    const db = await fixtureDb();
    // Only the German repress passes; it has no videos, the UK original has two.
    const repress = filters({ skipWithoutVideos: true, countries: ["Germany"] });
    expect(queryQueue(db, { filters: repress, strategy: "label_sweep", limit: 10 })).toEqual([
      expect.objectContaining({ id: 1002, videoCount: 0 }),
    ]);
    // Videos the repress cannot use, full sides of another tune, do not count.
    db.prepare("UPDATE videos SET matched_position = NULL WHERE release_id = 1001").run();
    expect(countRemaining(db, repress)).toBe(0);
    db.prepare("UPDATE videos SET matched_position = 'A1' WHERE release_id = 1001").run();
    expect(countRemaining(db, repress)).toBe(1);
    db.prepare("UPDATE videos SET embeddable = 0 WHERE release_id = 1001").run();
    expect(countRemaining(db, repress)).toBe(0);
    db.close();
  });

  it("excludes keys with a verdict and honours the other strategies", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:506", status: "rejected", source: "triage" });
    const f = filters({ yearFrom: null, yearTo: null, formats: [], includeUnknownYear: true });
    expect(
      queryQueue(db, { filters: f, strategy: "label_sweep", limit: 200 }).map((i) => i.id),
    ).toEqual([1004, 1001, 1003]);
    expect(countRemaining(db, f)).toBe(3);
    writeSnapshot(db, 1003, {
      lowestPrice: 5,
      numForSale: 1,
      currency: "EUR",
      communityHave: 10,
      communityWant: 900,
    });
    writeSnapshot(db, 1001, {
      lowestPrice: 5,
      numForSale: 1,
      currency: "EUR",
      communityHave: 10,
      communityWant: 50,
    });
    expect(
      queryQueue(db, { filters: f, strategy: "popular", limit: 200 }).map((i) => i.id),
    ).toEqual([1003, 1001, 1004]);
    expect(queryQueue(db, { filters: f, strategy: "year", limit: 200 }).map((i) => i.id)).toEqual([
      1004, 1001, 1003,
    ]);
    expect(
      queryQueue(db, { filters: f, strategy: "country", limit: 200 }).map((i) => i.id),
    ).toEqual([1004, 1001, 1003]);
    const r1 = queryQueue(db, { filters: f, strategy: "random", limit: 200, seed: 7 }).map(
      (i) => i.id,
    );
    const r2 = queryQueue(db, { filters: f, strategy: "random", limit: 200, seed: 7 }).map(
      (i) => i.id,
    );
    expect(r1).toEqual(r2);
    expect([...r1].sort((a, b) => a - b)).toEqual([1001, 1003, 1004]);
    db.close();
  });

  it("picks the main release with most videos as representative", async () => {
    const db = await fixtureDb();
    expect(representativeForKey(db, "m:501")!.id).toBe(1001);
    expect(representativeForKey(db, "r:1003")!.id).toBe(1003);
    expect(representativeForKey(db, "m:999")).toBeNull();
    db.close();
  });

  it("builds parameterised SQL", () => {
    const { sql, params } = buildQueueSql({
      filters: filters({ countries: ["UK"] }),
      strategy: "random",
      limit: 10,
      seed: 3,
    });
    expect(sql).toContain("json_each(r.formats_json)");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM verdicts");
    expect(params).toEqual([1998, 2002, "Vinyl", "UK", 3, 10, 0]);
  });
});
