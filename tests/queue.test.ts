import { describe, expect, it } from "vite-plus/test";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import {
  buildQueueSql,
  countRemaining,
  countUniverseKeys,
  queryQueue,
  representativeForKey,
} from "../src/server/queue/query.ts";
import { searchScopes } from "../src/server/queue/scopes.ts";
import {
  type Filters,
  type HiddenLabel,
  hiddenLabelsFromNames,
  withLabelExcluded,
} from "../src/shared/config.ts";
import type { ScopeRef } from "../src/shared/scope.ts";
import type { LabelRef } from "../src/shared/types.ts";
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
      labelId: 77,
      labelName: "Renegade Hardware",
      catno: "RH 20",
      formatSummary: '2 x Vinyl (12", 33 ⅓ RPM)',
    });
    expect(countRemaining(db, filters({}))).toBe(2);
    expect(countUniverseKeys(db, null)).toBe(4);
    expect(countUniverseKeys(db, filters({}))).toBe(2);
    db.close();
  });

  it("can revisit browser-history records without including other verdicts", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", releaseId: 1001, status: "seen", source: "seed:history" });
    upsertVerdict(db, { key: "m:506", releaseId: 1006, status: "rejected", source: "triage" });
    expect(countRemaining(db, filters({}))).toBe(0);
    const selection = filters({ skipHistory: false });
    expect(
      queryQueue(db, { filters: selection, strategy: "label_sweep", limit: 200 }).map(
        (release) => release.id,
      ),
    ).toEqual([1001]);
    expect(countRemaining(db, selection)).toBe(1);
    db.close();
  });

  it.each(["White Label", "Test Pressing"])(
    "prefers standard vinyl over a %s main release without excluding it",
    async (description) => {
      const db = await fixtureDb();
      db.prepare("UPDATE releases SET formats_json = ? WHERE id = 1001").run(
        JSON.stringify([{ name: "Vinyl", qty: 1, text: "", descriptions: ['12"', description] }]),
      );
      const queue = (selection: Filters) =>
        queryQueue(db, { filters: selection, strategy: "label_sweep", limit: 200 });
      expect(queue(filters({})).find((release) => release.triageKey === "m:501")?.id).toBe(1002);
      expect(representativeForKey(db, "m:501")?.id).toBe(1002);
      expect(
        queue(filters({ includeDescriptions: [description] })).map((release) => release.id),
      ).toEqual([1001]);
      expect(
        queue(filters({ countries: ["UK"] })).find((release) => release.triageKey === "m:501")?.id,
      ).toBe(1001);
      expect(countRemaining(db, filters({}))).toBe(2);
      db.close();
    },
  );

  it("lets in undated releases on the labels and artists of records the user wants", async () => {
    const db = await fixtureDb();
    const onCoverage = filters({ includeUnknownYearOnCoverage: true });
    const ids = () =>
      queryQueue(db, { filters: onCoverage, strategy: "label_sweep", limit: 200 }).map((i) => i.id);
    expect(ids()).toEqual([1006, 1001]);
    upsertVerdict(db, { key: "m:506", status: "accepted", source: "triage", releaseId: 1006 });
    // 1003 has no year and is on Renegade Hardware, the label of the wanted record.
    expect(ids()).toEqual([1001, 1003]);
    expect(countRemaining(db, onCoverage)).toBe(2);
    expect(countRemaining(db, { ...onCoverage, includeUnknownYearOnCoverage: false })).toBe(1);
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

  describe("hidden labels", () => {
    async function catalogue() {
      const db = await fixtureDb();
      const kept = (excludeLabels: HiddenLabel[]) =>
        queryQueue(db, { filters: filters({ excludeLabels }), strategy: "label_sweep", limit: 10 })
          .map((item) => item.id)
          .toSorted((left, right) => left - right);
      const relabel = (releaseId: number, labels: LabelRef[]) =>
        db
          .prepare("UPDATE releases SET labels_json = ?, label_name = ? WHERE id = ?")
          .run(JSON.stringify(labels), labels[0]?.name ?? null, releaseId);
      return { db, kept, relabel };
    }

    it("leave out records whose first label has the id, or the name of one without an id", async () => {
      const { db, kept, relabel } = await catalogue();
      // Both records are on Renegade Hardware (77); 1006 also names Renegade Hardware Ltd. (78).
      expect(kept([{ id: 77, name: "Renegade Hardware" }])).toEqual([]);
      expect(kept([{ id: 77, name: "A name Discogs has since changed" }])).toEqual([]);
      expect(kept([{ id: 78, name: "Renegade Hardware Ltd." }])).toEqual([1001, 1006]);
      expect(kept([{ id: null, name: "renegade hardware" }])).toEqual([]);
      expect(kept([{ id: null, name: "Renegade" }])).toEqual([1001, 1006]);
      expect(kept([{ id: null, name: "Moving Shadow" }])).toEqual([1001, 1006]);

      relabel(1006, [{ id: 79, name: "Renegade Hardware (2)", catno: "RH 18" }]);
      expect(kept([{ id: 77, name: "Renegade Hardware" }])).toEqual([1006]);
      expect(kept([{ id: null, name: "Renegade Hardware" }])).toEqual([1006]);
      db.close();
    });

    it("keep records without a first label or its id", async () => {
      const { db, kept, relabel } = await catalogue();
      relabel(1006, [{ id: null, name: "Renegade Hardware", catno: "RH 18" }]);
      expect(kept([{ id: 77, name: "Renegade Hardware" }])).toEqual([1006]);
      relabel(1006, []);
      const both = [
        { id: 77, name: "Renegade Hardware" },
        { id: null, name: "Moving Shadow" },
      ];
      expect(kept(both)).toEqual([1006]);
      db.close();
    });

    it("leave out every self-release with Not On Label, and one by its own id", async () => {
      const { db, kept, relabel } = await catalogue();
      // 1002 is a pressing of 1001's record.
      relabel(1001, [{ id: 1818, name: "Not on Label", catno: "none" }]);
      relabel(1002, [{ id: 1818, name: "Not On Label", catno: "none" }]);
      relabel(1006, [{ id: 4242, name: "Not On Label (Ed Rush Self-released)", catno: "none" }]);
      expect(kept([{ id: 1818, name: "Not On Label" }])).toEqual([]);
      expect(kept([{ id: null, name: "not on label" }])).toEqual([]);
      expect(kept([{ id: 4242, name: "Not On Label (Ed Rush Self-released)" }])).toEqual([1001]);
      db.close();
    });
  });

  it("leaves out format descriptions", async () => {
    const db = await fixtureDb();
    const ids = (overrides: Partial<Filters>) =>
      queryQueue(db, { filters: filters(overrides), strategy: "label_sweep", limit: 10 }).map(
        (item) => item.id,
      );
    expect(ids({})).toEqual([1006, 1001]);
    expect(ids({ includeDescriptions: ["45 RPM"] })).toEqual([1006]);
    expect(ids({ excludeDescriptions: ["45 RPM"] })).toEqual([1001]);
    expect(ids({ includeDescriptions: ['12"'], excludeDescriptions: ["Sampler"] })).toEqual([
      1006, 1001,
    ]);
    db.close();
  });

  it("adds and removes a label from the ones left out, by id when both have one", () => {
    const virgin = { id: null, name: "Virgin" };
    const movingShadow = { id: 88, name: "Moving Shadow" };
    const hidden = withLabelExcluded(filters({ excludeLabels: [virgin] }), movingShadow, true);
    expect(hidden.excludeLabels).toEqual([virgin, movingShadow]);
    expect(withLabelExcluded(hidden, movingShadow, true).excludeLabels).toHaveLength(2);
    expect(withLabelExcluded(hidden, { id: 88, name: "Renamed" }, false).excludeLabels).toEqual([
      virgin,
    ]);
    expect(
      withLabelExcluded(hidden, { id: 89, name: "Moving Shadow" }, false).excludeLabels,
    ).toEqual([virgin, movingShadow]);
    // Hiding the label by its id replaces the entry that has only its name.
    expect(withLabelExcluded(hidden, { id: 7, name: "VIRGIN" }, true).excludeLabels).toEqual([
      movingShadow,
      { id: 7, name: "VIRGIN" },
    ]);
  });

  it("keeps the id of a hidden label that a line of Settings still names", () => {
    const hidden: HiddenLabel[] = [
      { id: 88, name: "Moving Shadow" },
      { id: null, name: "Virgin" },
    ];
    expect(hiddenLabelsFromNames(["moving shadow", "Metalheadz"], hidden)).toEqual([
      { id: 88, name: "Moving Shadow" },
      { id: null, name: "Metalheadz" },
    ]);
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

  it("narrows to a label on any label line, or to an artist on the release or a track", async () => {
    const db = await fixtureDb();
    const ids = (scope: ScopeRef, overrides: Partial<Filters> = {}) =>
      queryQueue(db, {
        filters: filters(overrides),
        strategy: "label_sweep",
        limit: 10,
        scope,
      }).map((item) => item.id);
    expect(ids({ kind: "label", id: 77 })).toEqual([1006, 1001]);
    // 1006's second label.
    expect(ids({ kind: "label", id: 78 })).toEqual([1006]);
    // Filters still apply: Moving Shadow's only record is a CD from 1996.
    expect(ids({ kind: "label", id: 88 })).toEqual([]);
    expect(ids({ kind: "label", id: 88 }, { yearFrom: null, formats: [] })).toEqual([1004]);
    expect(ids({ kind: "artist", id: 12 })).toEqual([1001]);
    // Konflict: the artist of 1006, and of the tracks on the sampler 1003 by Various.
    expect(ids({ kind: "artist", id: 21 }, { includeUnknownYear: true })).toEqual([1006, 1003]);
    expect(countRemaining(db, filters({}), { kind: "artist", id: 21 })).toBe(1);
    upsertVerdict(db, { key: "m:506", status: "rejected", source: "triage" });
    expect(countRemaining(db, filters({}), { kind: "artist", id: 21 })).toBe(0);
    db.close();
  });

  it("shows the pressing in the scope, not the master's main release", async () => {
    const db = await fixtureDb();
    db.prepare(
      `UPDATE releases SET labels_json = '[{"id":99,"name":"Boxcutter","catno":"BOX 1"}]' WHERE id = 1002`,
    ).run();
    const items = queryQueue(db, {
      filters: filters({}),
      strategy: "label_sweep",
      limit: 10,
      scope: { kind: "label", id: 99 },
    });
    expect(items.map((item) => [item.id, item.triageKey])).toEqual([[1002, "m:501"]]);
    db.close();
  });

  it("finds labels and artists by part of their name, most records first", async () => {
    const db = await fixtureDb();
    expect(searchScopes(db, "renegade")).toEqual([
      { kind: "label", id: 77, name: "Renegade Hardware", records: 3 },
      { kind: "label", id: 78, name: "Renegade Hardware Ltd.", records: 1 },
    ]);
    // On the release 1006 and on the tracks of 1003.
    expect(searchScopes(db, "KONF")).toEqual([
      { kind: "artist", id: 21, name: "Konflict", records: 2 },
    ]);
    expect(searchScopes(db, "various")).toEqual([]);
    expect(searchScopes(db, "%")).toEqual([]);
    expect(searchScopes(db, "e", 2)).toHaveLength(2);
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
    const scoped = buildQueueSql({
      filters: filters({}),
      strategy: "label_sweep",
      limit: 10,
      scope: { kind: "artist", id: 21 },
    });
    expect(scoped.params).toEqual([21, 21, 1998, 2002, "Vinyl", 10, 0]);
  });
});
