import { describe, expect, it } from "vite-plus/test";
import type { DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsCollectionPage, DiscogsWantlistPage } from "../src/server/discogs/types.ts";
import { importCollection } from "../src/server/importers/collection.ts";
import { importWantlist } from "../src/server/importers/wantlist.ts";
import { applySeedItem } from "../src/server/importers/seeds.ts";
import { getRelease } from "../src/server/db/releases.ts";
import {
  applySeedVerdict,
  countDug,
  getVerdict,
  triageDecisionTimes,
  upsertVerdict,
} from "../src/server/db/verdicts.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

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
  it("creates stubs for unknown releases, keeps dump rows, writes verdicts with date_added", async () => {
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
      verdictsWritten: 3,
    });
    expect(progress).toEqual([2, 3]);
    expect(getRelease(db, 1001)!.inUniverse).toBe(true);
    const stub = getRelease(db, 9001)!;
    expect(stub.inUniverse).toBe(false);
    expect(stub.triageKey).toBe("m:9500");
    expect(stub.artistDisplay).toBe("Someone");
    expect(stub.isVinyl).toBe(true);
    expect(getVerdict(db, "m:501")).toMatchObject({
      status: "collection",
      source: "seed:collection",
      releaseId: 1001,
      decidedAt: "2020-01-02T00:00:00-08:00",
    });
    expect(getVerdict(db, "m:9500")!.status).toBe("collection");
    expect(getVerdict(db, "r:9002")!.status).toBe("collection");
    const seed = db
      .prepare("SELECT kind, date_added, rating FROM seed_items WHERE release_id = 1001")
      .get();
    expect(seed).toEqual({
      kind: "collection",
      date_added: "2020-01-02T00:00:00-08:00",
      rating: 4,
    });
    db.close();
  });

  it("wantlist never downgrades a collection verdict", async () => {
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
    expect(result).toMatchObject({ kind: "wantlist", processed: 2, stubs: 0, verdictsWritten: 1 });
    expect(getVerdict(db, "m:501")!.status).toBe("collection");
    expect(getVerdict(db, "m:506")).toMatchObject({
      status: "wantlist",
      notes: null,
      releaseId: 1006,
    });
    db.close();
  });

  it("requires a username", async () => {
    const db = await fixtureDb();
    await expect(
      importWantlist({ db, discogs: fakeDiscogs([], []), logger: silentLogger }, { username: "" }),
    ).rejects.toThrow(/username/);
    db.close();
  });
});

describe("seed precedence", () => {
  it("history 'seen' never overrides a triage decision, but collection does", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage" });
    expect(
      applySeedVerdict(db, { key: "m:501", status: "seen", source: "seed:history" }).written,
    ).toBe(false);
    expect(getVerdict(db, "m:501")!.status).toBe("rejected");
    expect(
      applySeedVerdict(db, { key: "m:501", status: "collection", source: "seed:collection" })
        .written,
    ).toBe(true);
    expect(getVerdict(db, "m:501")!.status).toBe("collection");
    expect(
      applySeedVerdict(db, { key: "m:501", status: "wantlist", source: "seed:wantlist" }).written,
    ).toBe(false);
    db.close();
  });

  it("keeps a grail through the wantlist import, until the record is owned", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "candidate", source: "triage" });
    const seed = { releaseId: 1001, masterId: 501, dateAdded: null, rating: null, notes: null };
    const info = basic(1001, 501, "Wormhole");
    applySeedItem(db, { ...seed, kind: "wantlist", basicInformation: info });
    expect(getVerdict(db, "m:501")?.status).toBe("candidate");
    applySeedItem(db, { ...seed, kind: "collection", basicInformation: info });
    expect(getVerdict(db, "m:501")?.status).toBe("collection");
    db.close();
  });

  it("still counts a want as dug, at its own time, after the wantlist import takes it over", async () => {
    const db = await fixtureDb();
    const dugAt = "2026-10-03T21:15:00.000Z";
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", decidedAt: dugAt });
    upsertVerdict(db, { key: "m:506", status: "wantlist", source: "seed:wantlist" });
    const seed = { releaseId: 1001, masterId: 501, rating: null, notes: null };
    applySeedItem(db, {
      ...seed,
      kind: "wantlist",
      dateAdded: "2026-10-03T21:15:02.000Z",
      basicInformation: basic(1001, 501, "Wormhole"),
    });

    expect(getVerdict(db, "m:501")).toMatchObject({ status: "wantlist", dugAt });
    expect(getVerdict(db, "m:506")?.dugAt).toBeNull();
    expect(countDug(db)).toBe(1);
    expect(triageDecisionTimes(db)).toEqual([dugAt]);
    db.close();
  });

  it("keeps the note written in Digga when the wantlist import takes over a want", async () => {
    const db = await fixtureDb();
    const note = "the Kool FM tune, ".repeat(20);
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", notes: note });
    const seed = { releaseId: 1001, masterId: 501, dateAdded: null, rating: null };
    applySeedItem(db, {
      ...seed,
      kind: "wantlist",
      notes: "grail A1; the Kool FM tune...",
      basicInformation: basic(1001, 501, "Wormhole"),
    });
    expect(getVerdict(db, "m:501")).toMatchObject({ status: "wantlist", notes: note });
    applySeedItem(db, {
      ...seed,
      releaseId: 1006,
      masterId: 506,
      kind: "wantlist",
      notes: "from Discogs",
      basicInformation: basic(1006, 506, "Messiah"),
    });
    expect(getVerdict(db, "m:506")?.notes).toBe("from Discogs");
    db.close();
  });
});
