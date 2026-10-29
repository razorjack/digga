import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { recordMembership } from "../src/server/db/memberships.ts";
import {
  notesForReleases,
  pressingNotes,
  releaseNote,
  saveReleaseNote,
} from "../src/server/db/notes.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import {
  queueItemForRelease,
  representativesForKeys,
  representativeForKey,
} from "../src/server/queue/query.ts";
import { queryTwelves } from "../src/server/queue/twelves.ts";
import { filters, fixtureDb } from "./helpers.ts";

describe("batched shelf reads", () => {
  let db: Db;
  beforeEach(async () => {
    db = await fixtureDb();
  });
  afterEach(() => db.close());

  it("keeps a saved pressing, falls back for absent IDs, and retains records with no release", () => {
    for (const [key, releaseId] of [
      ["m:501", 1002],
      ["m:506", 9000],
      ["r:9001", null],
    ] as const)
      upsertVerdict(db, { key, releaseId, status: "accepted", source: "triage" });
    recordMembership(db, {
      kind: "collection",
      releaseId: 1003,
      masterId: null,
      dateAdded: null,
      rating: null,
      notes: null,
    });
    const items = queryTwelves(db, null, null);
    expect(items).toHaveLength(4);
    expect(items.find((item) => item.key === "m:501")?.release).toEqual(
      queueItemForRelease(db, 1002),
    );
    expect(items.find((item) => item.key === "m:506")?.release).toEqual(
      representativeForKey(db, "m:506"),
    );
    expect(items.find((item) => item.key === "r:9001")).toMatchObject({
      release: null,
      note: null,
      pressingNotes: [],
    });
    expect(items.find((item) => item.key === "r:1003")).toMatchObject({
      verdict: null,
      membership: { owned: true },
    });
    expect(queryTwelves(db, ["accepted"], null)).toHaveLength(3);
    expect(queryTwelves(db, [], null)).toEqual([]);
    expect(
      queryTwelves(db, null, filters({}))
        .map((item) => item.release!.id)
        .sort((left, right) => left - right),
    ).toEqual([1002, 1003, 1006]);
    expect(
      queryTwelves(db, null, filters({ countries: ["Germany"] })).map((item) => item.key),
    ).toEqual(["m:501"]);
    expect(
      queryTwelves(db, null, filters({ countries: ["UK"] })).map((item) => item.key),
    ).not.toContain("m:501");
  });

  it("uses the same representative ranking for batched and individual reads", () => {
    const keys = ["m:501", "m:506", "r:1003", "r:9000"];
    const representatives = representativesForKeys(db, keys);
    for (const key of keys)
      expect(representatives.get(key) ?? null).toEqual(representativeForKey(db, key));
    db.prepare(`UPDATE releases SET formats_json = '[{"name":"Vinyl","descriptions":["White Label"]}]'
      WHERE id = 1001`).run();
    expect(representativesForKeys(db, keys).get("m:501")?.id).toBe(1002);
    expect(representativesForKeys(db, [])).toEqual(new Map());
  });

  it("keeps own notes, sibling notes and their order, without sharing notes across standalone releases", () => {
    db.prepare(`INSERT INTO releases (id, master_id, triage_key, updated_at)
      VALUES (1007, 501, 'm:501', '2026-01-01')`).run();
    const releases = [1001, 1002, 1003, 1004, 1007].map((id) => queueItemForRelease(db, id)!);
    for (const release of releases) saveReleaseNote(db, release.id, `Note ${release.id}`);
    db.prepare("UPDATE release_notes SET updated_at = '2020-01-01' WHERE release_id = 1001").run();
    for (const release of releases) {
      expect(notesForReleases(db, releases).get(release.id)).toEqual({
        note: releaseNote(db, release.id) ?? null,
        pressingNotes: pressingNotes(db, release),
      });
    }
    saveReleaseNote(db, 1001, null);
    expect(
      notesForReleases(db, releases)
        .get(1002)
        ?.pressingNotes.map((note) => note.releaseId),
    ).toEqual([1007]);
    expect(notesForReleases(db, []).size).toBe(0);
  });
});
