import { describe, expect, it } from "vite-plus/test";
import type { DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsCollectionPage, DiscogsWantlistPage } from "../src/server/discogs/types.ts";
import { importCollection } from "../src/server/importers/collection.ts";
import { importWantlist } from "../src/server/importers/wantlist.ts";
import { applySeedItem } from "../src/server/importers/seeds.ts";
import {
  accountConflict,
  forgetAccountData,
  heldAccount,
  recordMembershipOf,
} from "../src/server/db/memberships.ts";
import { releaseNote, saveReleaseNote } from "../src/server/db/notes.ts";
import { getRelease } from "../src/server/db/releases.ts";
import {
  countDug,
  getVerdict,
  triageDecisionTimes,
  upsertVerdict,
} from "../src/server/db/verdicts.ts";
import { queryQueue } from "../src/server/queue/query.ts";
import { filters, fixtureDb, silentLogger } from "./helpers.ts";

const basic = (id: number, master: number | null, title: string) => ({
  id,
  master_id: master,
  title,
  year: 2001,
  artists: [{ id: 1, name: "Someone (3)", anv: "", join: "" }],
  labels: [{ id: 5, name: "Label", catno: "LBL 1" }],
  formats: [{ name: "Vinyl", qty: "1", descriptions: ['12"'] }],
  genres: ["Electronic"],
  styles: ["Drum n Bass"],
});

function fakeDiscogs(
  collection: DiscogsCollectionPage[],
  wants: DiscogsWantlistPage[],
): DiscogsClient {
  return {
    getRelease: () => Promise.reject(new Error("unused")),
    getCollectionPage: (_u, page) => Promise.resolve(collection[page - 1]!),
    getWantlistPage: (_u, page) => Promise.resolve(wants[page - 1]!),
    getIdentity: () => Promise.reject(new Error("unused")),
    getMaster: () => Promise.reject(new Error("unused")),
    getUserLists: () => Promise.reject(new Error("unused")),
    getList: () => Promise.reject(new Error("unused")),
    addToWantlist: () => Promise.reject(new Error("unused")),
    removeFromWantlist: () => Promise.reject(new Error("unused")),
    getUser: () => Promise.reject(new Error("unused")),
    getInventoryPage: () => Promise.reject(new Error("unused")),
    hasToken: () => true,
  };
}

describe("collection and wantlist importers", () => {
  it("creates stubs for unknown releases, keeps dump rows, and holds every item apart from verdicts", async () => {
    const db = await fixtureDb();
    const pages: DiscogsCollectionPage[] = [
      {
        pagination: { page: 1, pages: 2, per_page: 2, items: 3 },
        releases: [
          {
            id: 1001,
            instance_id: 1,
            date_added: "2020-01-02T00:00:00-08:00",
            rating: 4,
            basic_information: basic(1001, 501, "Wormhole"),
          },
          {
            id: 9001,
            instance_id: 2,
            date_added: "2021-05-05T00:00:00-08:00",
            basic_information: basic(9001, 9500, "Unknown EP"),
          },
        ],
      },
      {
        pagination: { page: 2, pages: 2, per_page: 2, items: 3 },
        releases: [
          {
            id: 9002,
            instance_id: 3,
            date_added: "2022-01-01T00:00:00-08:00",
            basic_information: basic(9002, null, "Orphan"),
          },
        ],
      },
    ];
    const progress: number[] = [];
    const result = await importCollection(
      { db, discogs: fakeDiscogs(pages, []), logger: silentLogger },
      { username: "dj" },
      (p) => progress.push(p.processed),
    );
    expect(result).toMatchObject({
      kind: "collection",
      pages: 2,
      processed: 3,
      stubs: 2,
      added: 3,
    });
    // The last report follows the reconciliation, with what the account no longer lists.
    expect(progress).toEqual([2, 3, 3]);
    expect(getRelease(db, 1001)!.inUniverse).toBe(true);
    const stub = getRelease(db, 9001)!;
    expect(stub.inUniverse).toBe(false);
    expect(stub.triageKey).toBe("m:9500");
    expect(stub.artistDisplay).toBe("Someone");
    expect(stub.isVinyl).toBe(true);
    expect(db.prepare("SELECT COUNT(*) FROM verdicts").pluck().get()).toBe(0);
    for (const key of ["m:501", "m:9500", "r:9002"])
      expect(recordMembershipOf(db, key)).toEqual({
        owned: true,
        onWantlist: false,
        onList: false,
        wantRemoved: false,
      });
    const held = db
      .prepare("SELECT kind, date_added, rating FROM memberships WHERE release_id = 1001")
      .get();
    expect(held).toEqual({
      kind: "collection",
      date_added: "2020-01-02T00:00:00-08:00",
      rating: 4,
    });
    const again = await importCollection(
      { db, discogs: fakeDiscogs(pages, []), logger: silentLogger },
      { username: "dj" },
    );
    expect(again.added).toBe(0);
    db.close();
  });

  it("holds a record in the collection and on the wantlist at once", async () => {
    const db = await fixtureDb();
    const collection: DiscogsCollectionPage[] = [
      {
        pagination: { page: 1, pages: 1, per_page: 100, items: 1 },
        releases: [
          {
            id: 1001,
            instance_id: 1,
            date_added: "2020-01-02",
            basic_information: basic(1001, 501, "Wormhole"),
          },
        ],
      },
    ];
    const wants: DiscogsWantlistPage[] = [
      {
        pagination: { page: 1, pages: 1, per_page: 100, items: 2 },
        wants: [
          {
            id: 1002,
            date_added: "2023-01-01",
            notes: "repress",
            basic_information: basic(1002, 501, "Wormhole"),
          },
          { id: 1006, date_added: "2023-02-01", basic_information: basic(1006, 506, "Messiah") },
        ],
      },
    ];
    const discogs = fakeDiscogs(collection, wants);
    await importCollection({ db, discogs, logger: silentLogger }, { username: "dj" });
    const result = await importWantlist({ db, discogs, logger: silentLogger }, { username: "dj" });
    expect(result).toMatchObject({ kind: "wantlist", processed: 2, stubs: 0, added: 2 });
    expect(recordMembershipOf(db, "m:501")).toEqual({
      owned: true,
      onWantlist: true,
      onList: false,
      wantRemoved: false,
    });
    expect(
      db
        .prepare("SELECT notes FROM memberships WHERE kind = 'wantlist' AND release_id = 1002")
        .get(),
    ).toEqual({ notes: "repress" });
    db.close();
  });

  it("marks what a complete import no longer finds, which stays out of the queue", async () => {
    const db = await fixtureDb();
    const wantlistOf = (...ids: number[]): DiscogsWantlistPage[] => [
      {
        pagination: { page: 1, pages: 1, per_page: 100, items: ids.length },
        wants: ids.map((id) => ({
          id,
          date_added: "2026-09-01T00:00:00-07:00",
          basic_information: basic(id, null, `Want ${id}`),
        })),
      },
    ];
    const deps = (ids: number[]) => ({
      db,
      discogs: fakeDiscogs([], wantlistOf(...ids)),
      logger: silentLogger,
    });
    upsertVerdict(db, { key: "r:1004", status: "accepted", source: "triage", releaseId: 1004 });
    await importWantlist(deps([1004, 1006]), { username: "dj" });

    const result = await importWantlist(deps([1006]), { username: "dj" });

    expect(result.removed).toBe(1);
    expect(recordMembershipOf(db, "r:1004")).toEqual({
      owned: false,
      onWantlist: false,
      onList: false,
      wantRemoved: true,
    });
    expect(
      queryQueue(db, {
        filters: filters({ yearFrom: null, yearTo: null }),
        strategy: "label_sweep",
        limit: 10,
      }).map((item) => item.id),
    ).not.toContain(1004);
    const cancelled = new AbortController();
    cancelled.abort();
    const stopped = await importWantlist(deps([]), { username: "dj", signal: cancelled.signal });
    expect(stopped.removed).toBe(0);
    expect(recordMembershipOf(db, "m:506").onWantlist).toBe(true);
    db.close();
  });

  it("stores a release without a master, which Discogs sends as master 0, with none", async () => {
    const db = await fixtureDb();
    const wants: DiscogsWantlistPage[] = [
      {
        pagination: { page: 1, pages: 1, per_page: 100, items: 1 },
        wants: [
          {
            id: 9001,
            date_added: "2026-09-01T00:00:00-07:00",
            basic_information: basic(9001, 0, "Unknown EP"),
          },
        ],
      },
    ];
    await importWantlist(
      { db, discogs: fakeDiscogs([], wants), logger: silentLogger },
      { username: "dj" },
    );

    expect(db.prepare("SELECT master_id FROM memberships").pluck().all()).toEqual([null]);
    expect(recordMembershipOf(db, "r:9001").onWantlist).toBe(true);
    db.close();
  });

  it("requires a username", async () => {
    const db = await fixtureDb();
    await expect(
      importWantlist({ db, discogs: fakeDiscogs([], []), logger: silentLogger }, { username: "" }),
    ).rejects.toThrow(/username/);
    db.close();
  });

  it("refuses another account while the library holds one's items, until they are forgotten", async () => {
    const db = await fixtureDb();
    const wants: DiscogsWantlistPage[] = [
      {
        pagination: { page: 1, pages: 1, per_page: 100, items: 1 },
        wants: [
          {
            id: 9001,
            date_added: "2026-09-01T00:00:00-07:00",
            basic_information: basic(9001, null, "Unknown EP"),
          },
        ],
      },
    ];
    const deps = { db, discogs: fakeDiscogs([], wants), logger: silentLogger };
    await importWantlist(deps, { username: "dj" });

    await expect(importCollection(deps, { username: "Other" })).rejects.toThrow(
      "This library holds the Discogs collection and wantlist of dj; forget them in Settings before using Other",
    );
    await importWantlist(deps, { username: "DJ" });
    expect(heldAccount(db, "")).toBe("DJ");

    expect(forgetAccountData(db)).toBe(1);
    expect(heldAccount(db, "dj")).toBeNull();
    await importWantlist(deps, { username: "Other" });
    expect(heldAccount(db, "")).toBe("Other");
    db.close();
  });

  it("takes a library from before Digga recorded the account as the configured account's", async () => {
    const db = await fixtureDb();
    applySeedItem(db, {
      kind: "collection",
      releaseId: 9001,
      masterId: null,
      dateAdded: null,
      rating: null,
      notes: null,
      basicInformation: basic(9001, null, "Unknown EP"),
    });

    expect(heldAccount(db, "dj")).toBe("dj");
    expect(accountConflict(db, "other", "dj")).toMatch(/of dj; forget them/);
    expect(accountConflict(db, "", "dj")).toBeNull();
    db.close();
  });
});

describe("the Discogs account beside decisions made in Digga", () => {
  it("leaves decisions alone", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage", releaseId: 1001 });
    const seed = { releaseId: 1001, masterId: 501, dateAdded: null, rating: null, notes: null };
    applySeedItem(db, { ...seed, kind: "collection", basicInformation: basic(1001, 501, "W") });

    expect(getVerdict(db, "m:501")?.status).toBe("rejected");
    expect(recordMembershipOf(db, "m:501").owned).toBe(true);
    db.close();
  });

  it("keeps a grail and its date when the record reaches the wantlist and the collection", async () => {
    const db = await fixtureDb();
    const decidedAt = "2026-10-03T21:15:00.000Z";
    upsertVerdict(db, { key: "m:501", status: "candidate", source: "triage", decidedAt });
    const seed = { releaseId: 1001, masterId: 501, dateAdded: null, rating: null, notes: null };
    const info = basic(1001, 501, "Wormhole");
    applySeedItem(db, { ...seed, kind: "wantlist", basicInformation: info });
    applySeedItem(db, { ...seed, kind: "collection", basicInformation: info });

    expect(getVerdict(db, "m:501")).toMatchObject({ status: "candidate", decidedAt });
    expect(recordMembershipOf(db, "m:501")).toEqual({
      owned: true,
      onWantlist: true,
      onList: false,
      wantRemoved: false,
    });
    expect(countDug(db)).toBe(1);
    expect(triageDecisionTimes(db)).toEqual([decidedAt]);
    db.close();
  });

  it("keeps the note written in Digga apart from the note Discogs has on the want", async () => {
    const db = await fixtureDb();
    const note = "the Kool FM tune, ".repeat(20);
    saveReleaseNote(db, 1001, note);
    applySeedItem(db, {
      releaseId: 1001,
      masterId: 501,
      dateAdded: null,
      rating: null,
      kind: "wantlist",
      notes: "grail A1; the Kool FM tune...",
      basicInformation: basic(1001, 501, "Wormhole"),
    });

    expect(releaseNote(db, 1001)).toBe(note);
    expect(db.prepare("SELECT notes FROM memberships WHERE release_id = 1001").pluck().get()).toBe(
      "grail A1; the Kool FM tune...",
    );
    db.close();
  });
});
