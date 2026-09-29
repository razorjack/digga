import { describe, expect, it } from "vite-plus/test";
import { getRelease, getVideos } from "../src/server/db/releases.ts";
import { DiscogsApiError, type DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsRelease } from "../src/server/discogs/types.ts";
import { recordNoAudioVideos } from "../src/server/queue/no-audio.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { enrich, enrichTwelves } from "../src/server/jobs/enrich.ts";
import { countEnrichedRemaining } from "../src/server/queue/query.ts";
import { filters, fixtureDb, silentLogger } from "./helpers.ts";

function fakeDiscogs(handler: (id: number) => Promise<DiscogsRelease>): DiscogsClient {
  return {
    getRelease: (id) => handler(id),
    getCollectionPage: () => Promise.reject(new Error("unused")),
    getWantlistPage: () => Promise.reject(new Error("unused")),
    getIdentity: () => Promise.reject(new Error("unused")),
    getMaster: () => Promise.reject(new Error("unused")),
    getUserLists: () => Promise.reject(new Error("unused")),
    getList: () => Promise.reject(new Error("unused")),
    addToWantlist: () => Promise.reject(new Error("unused")),
    removeFromWantlist: () => Promise.reject(new Error("unused")),
    getUser: () => Promise.reject(new Error("unused")),
    getInventoryPage: () => Promise.reject(new Error("unused")),
    rateLimit: () => ({ limit: null, remaining: null, used: null }),
    hasToken: () => true,
  };
}

const apiRelease = (id: number): DiscogsRelease => ({
  id,
  title: "x",
  lowest_price: 12.5,
  num_for_sale: 3,
  community: { have: 100, want: 250 },
  videos: [
    {
      uri: "https://www.youtube.com/watch?v=aaaaaaaaaa1",
      title: "Ed Rush & Optical - Wormhole",
      duration: 372,
      embed: true,
    },
    {
      uri: "https://www.youtube.com/watch?v=newnewnew01",
      title: "Ed Rush & Optical - Funktion",
      duration: 340,
      embed: true,
    },
  ],
});

describe("enrich", () => {
  it("enriches the next N queue items in order and refreshes videos", async () => {
    const db = await fixtureDb();
    const asked: number[] = [];
    const discogs = fakeDiscogs((id) => {
      asked.push(id);
      return Promise.resolve(apiRelease(id));
    });
    const opts = {
      ahead: 2,
      currency: "EUR",
      filters: filters({ includeUnknownYear: true }),
      strategy: "label_sweep" as const,
    };
    const r = await enrich({ db, discogs, logger: silentLogger }, opts);
    expect(r).toMatchObject({ done: 2, total: 2, failed: 0, aborted: false });
    expect(asked).toEqual([1006, 1001]);
    const rel = getRelease(db, 1001)!;
    expect(rel.snapshot).toMatchObject({
      lowestPrice: 12.5,
      numForSale: 3,
      currency: "EUR",
      communityHave: 100,
      communityWant: 250,
    });
    expect(rel.snapshot.enrichedAt).not.toBeNull();
    expect(getVideos(db, 1001).map((v) => [v.videoId, v.matchedPosition])).toEqual([
      ["aaaaaaaaaa1", "A1"],
      ["newnewnew01", "A2"],
    ]);
    const again = await enrich({ db, discogs, logger: silentLogger }, opts);
    expect(again.total).toBe(1);
    expect(asked).toEqual([1006, 1001, 1003]);
    db.close();
  });

  it("stops on abort and records failures without throwing", async () => {
    const db = await fixtureDb();
    const controller = new AbortController();
    controller.abort();
    const discogs = fakeDiscogs(() => Promise.reject(new DiscogsApiError(404, "gone")));
    const opts = {
      ahead: 5,
      currency: "EUR",
      filters: filters({}),
      strategy: "label_sweep" as const,
      signal: controller.signal,
    };
    const r = await enrich({ db, discogs, logger: silentLogger }, opts);
    expect(r).toMatchObject({ done: 0, aborted: true });
    const r2 = await enrich({ db, discogs, logger: silentLogger }, { ...opts, signal: undefined });
    expect(r2).toMatchObject({ done: 0, failed: 2, total: 2 });
    expect(getRelease(db, 1001)!.snapshot.enrichedAt).not.toBeNull();
    db.close();
  });

  it("propagates auth failures", async () => {
    const db = await fixtureDb();
    const discogs = fakeDiscogs(() => Promise.reject(new DiscogsApiError(401, "bad token")));
    await expect(
      enrich(
        { db, discogs, logger: silentLogger },
        { ahead: 1, currency: "EUR", filters: filters({}), strategy: "label_sweep" },
      ),
    ).rejects.toBeInstanceOf(DiscogsApiError);
    db.close();
  });

  it("enriches every record to dig when no count is given", async () => {
    const db = await fixtureDb();
    const asked: number[] = [];
    const discogs = fakeDiscogs((id) => {
      asked.push(id);
      return Promise.resolve(apiRelease(id));
    });
    const queue = filters({ includeUnknownYear: true });
    expect(countEnrichedRemaining(db, queue)).toBe(0);
    const result = await enrich(
      { db, discogs, logger: silentLogger },
      { ahead: null, currency: "EUR", filters: queue, strategy: "label_sweep" },
    );
    expect(result).toMatchObject({ done: 3, total: 3 });
    expect(asked).toEqual([1006, 1001, 1003]);
    expect(countEnrichedRemaining(db, queue)).toBe(3);
    db.close();
  });

  it("refreshes the Twelves records, never enriched first, then the oldest", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", releaseId: 1002 });
    upsertVerdict(db, { key: "m:506", status: "snoozed", source: "triage" });
    upsertVerdict(db, { key: "r:1003", status: "rejected", source: "triage" });
    const asked: number[] = [];
    const discogs = fakeDiscogs((id) => {
      asked.push(id);
      return Promise.resolve(apiRelease(id));
    });
    const deps = { db, discogs, logger: silentLogger };
    await enrichTwelves(deps, { ahead: 1, currency: "EUR" });
    await enrichTwelves(deps, { ahead: null, currency: "EUR" });
    // The want shows the pressing it was made on; a skip is not on a shelf.
    expect(asked).toEqual([1002, 1006, 1002]);
    expect(getRelease(db, 1006)!.snapshot.communityWant).toBe(250);
    db.close();
  });

  it("sends a no-audio record back to the queue when enrich finds a new video", async () => {
    const db = await fixtureDb();
    const verdict = upsertVerdict(db, {
      key: "m:501",
      status: "no_audio",
      source: "triage",
      releaseId: 1001,
    });
    recordNoAudioVideos(db, verdict);
    const discogs = fakeDiscogs((id) => Promise.resolve(apiRelease(id)));
    await enrichTwelves({ db, discogs, logger: silentLogger }, { ahead: null, currency: "EUR" });
    expect(getVerdict(db, "m:501")).toBeNull();
    db.close();
  });
});
