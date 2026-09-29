import { describe, expect, it } from "vite-plus/test";
import { getRelease } from "../src/server/db/releases.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import type { DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsList, DiscogsRelease } from "../src/server/discogs/types.ts";
import { importList, listEntriesForApi, resolveListEntries } from "../src/server/importers/list.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

const release = (id: number, masterId: number | null, title: string): DiscogsRelease => ({
  id,
  master_id: masterId ?? undefined,
  title,
  year: 2000,
  country: "UK",
  artists: [{ id: 7, name: "Somebody (2)" }],
  labels: [{ id: 8, name: "Label", catno: "LBL 9" }],
  formats: [{ name: "Vinyl", qty: "1", descriptions: ['12"'] }],
  styles: ["Drum n Bass"],
});

const LIST: DiscogsList = {
  id: 77,
  name: "Maybe",
  items: [
    { id: 1001, type: "release", display_title: "Ed Rush & Optical - Wormhole" },
    { id: 506, type: "master", display_title: "Konflict - Messiah", comment: "check the flip" },
    { id: 9001, type: "release", display_title: "Somebody - Outside" },
    { id: 9600, type: "master", display_title: "Somebody - Master" },
    { id: 3, type: "artist", display_title: "An Artist" },
    { id: 9999, type: "release", display_title: "Gone - Deleted" },
  ],
};

function fakeDiscogs(calls: string[]): DiscogsClient {
  const unused = () => Promise.reject(new Error("unused"));
  return {
    getRelease: (id) => {
      calls.push(`release ${id}`);
      if (id === 9001) return Promise.resolve(release(9001, 9500, "Outside"));
      if (id === 9601) return Promise.resolve(release(9601, null, "Main"));
      return Promise.reject(new Error("404"));
    },
    getMaster: (id) => {
      calls.push(`master ${id}`);
      return Promise.resolve({ id, main_release: 9601 });
    },
    getList: () => Promise.resolve(LIST),
    getUserLists: unused,
    getCollectionPage: unused,
    getWantlistPage: unused,
    getIdentity: unused,
    addToWantlist: unused,
    removeFromWantlist: unused,
    getUser: unused,
    getInventoryPage: unused,
    rateLimit: () => ({ limit: null, remaining: null, used: null }),
    hasToken: () => true,
  };
}

describe("Discogs Maybe list import", () => {
  it("maps list entries to triage keys, looking up only what the dump lacks", async () => {
    const db = await fixtureDb();
    const calls: string[] = [];
    const deps = { db, discogs: fakeDiscogs(calls), logger: silentLogger };
    const entries = await resolveListEntries(deps, LIST.items, { currency: "EUR" });
    expect(entries.map((e) => [e.type, e.discogsId, e.key, e.releaseId, e.stub !== null])).toEqual([
      ["release", 1001, "m:501", 1001, false],
      ["master", 506, "m:506", 1006, false],
      ["release", 9001, "m:9500", 9001, true],
      ["master", 9600, "m:9600", 9601, true],
      ["release", 9999, "r:9999", 9999, false],
    ]);
    expect(calls).toEqual(["release 9001", "master 9600", "release 9601", "release 9999"]);
    const api = listEntriesForApi(db, entries);
    expect(api[1]).toMatchObject({
      comment: "check the flip",
      release: { id: 1006 },
      verdict: null,
    });
    expect(api[2]!.release).toMatchObject({ id: 9001, catno: "LBL 9", country: "UK" });
    expect(getRelease(db, 9001)).toBeNull();
    db.close();
  });

  it("marks entries maybe, below want and grail, and turns a triage maybe into a list seed", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });
    upsertVerdict(db, { key: "m:506", status: "maybe", source: "triage", notes: "mine" });
    const deps = { db, discogs: fakeDiscogs([]), logger: silentLogger };
    const result = await importList(deps, { listId: 77, currency: "EUR" });
    expect(result).toMatchObject({ kind: "list", listName: "Maybe", processed: 5, stubs: 2 });
    expect(result.verdictsWritten).toBe(4);
    expect(getVerdict(db, "m:501")).toMatchObject({ status: "accepted", source: "triage" });
    expect(getVerdict(db, "m:506")).toMatchObject({
      status: "maybe",
      source: "seed:list",
      notes: "check the flip",
    });
    expect(getVerdict(db, "m:9600")).toMatchObject({ status: "maybe", releaseId: 9601 });
    expect(getRelease(db, 9601)).toMatchObject({ masterId: 9600, inUniverse: false });
    const again = await importList(deps, { listId: 77, currency: "EUR" });
    expect(again.verdictsWritten).toBe(0);
    db.close();
  });
});
