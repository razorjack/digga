import { describe, expect, it } from "vite-plus/test";
import { getRelease, getVideos } from "../src/server/db/releases.ts";
import { DiscogsApiError, type DiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsRelease } from "../src/server/discogs/types.ts";
import { recordNoAudioVideos } from "../src/server/queue/no-audio.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { enrichRelease } from "../src/server/enrich.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

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
    withSignal() {
      return this;
    },
    withRetries() {
      return this;
    },
    hasToken: () => true,
  };
}

const apiRelease = (id: number): DiscogsRelease => ({
  id,
  title: "x",
  lowest_price: 12.5,
  num_for_sale: 3,
  community: { have: 100, want: 250, rating: { average: 4.25, count: 12 } },
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

describe("enriching one release", () => {
  it("stores its market data and current videos, matched to its tracks", async () => {
    const db = await fixtureDb();
    const discogs = fakeDiscogs((id) => Promise.resolve(apiRelease(id)));
    expect(await enrichRelease({ db, discogs, logger: silentLogger }, 1001, "EUR")).toBe(true);
    const release = getRelease(db, 1001)!;
    expect(release.snapshot).toMatchObject({
      lowestPrice: 12.5,
      numForSale: 3,
      currency: "EUR",
      communityHave: 100,
      communityWant: 250,
      ratingAverage: 4.25,
      ratingCount: 12,
    });
    expect(release.snapshot.enrichedAt).not.toBeNull();
    expect(getVideos(db, 1001).map((v) => [v.videoId, v.matchedPosition])).toEqual([
      ["aaaaaaaaaa1", "A1"],
      ["newnewnew01", "A2"],
    ]);
    db.close();
  });

  it("stores an unrated release without an average", async () => {
    const db = await fixtureDb();
    const unrated = { ...apiRelease(1001), community: { rating: { average: 0, count: 0 } } };
    const discogs = fakeDiscogs(() => Promise.resolve(unrated));
    await enrichRelease({ db, discogs, logger: silentLogger }, 1001, "EUR");
    expect(getRelease(db, 1001)!.snapshot).toMatchObject({ ratingAverage: null, ratingCount: 0 });
    db.close();
  });

  it("leaves a release Discogs no longer has without market data", async () => {
    const db = await fixtureDb();
    const discogs = fakeDiscogs(() => Promise.reject(new DiscogsApiError(404, "gone")));
    expect(await enrichRelease({ db, discogs, logger: silentLogger }, 1001, "EUR")).toBe(false);
    expect(getRelease(db, 1001)!.snapshot.enrichedAt).toBeNull();
    db.close();
  });

  it("propagates auth failures", async () => {
    const db = await fixtureDb();
    const discogs = fakeDiscogs(() => Promise.reject(new DiscogsApiError(401, "bad token")));
    await expect(
      enrichRelease({ db, discogs, logger: silentLogger }, 1001, "EUR"),
    ).rejects.toBeInstanceOf(DiscogsApiError);
    db.close();
  });

  it("sends a no-audio record back to the queue when it finds a new video", async () => {
    const db = await fixtureDb();
    const verdict = upsertVerdict(db, {
      key: "m:501",
      status: "no_audio",
      source: "triage",
      releaseId: 1001,
    });
    recordNoAudioVideos(db, verdict);
    const discogs = fakeDiscogs((id) => Promise.resolve(apiRelease(id)));
    await enrichRelease({ db, discogs, logger: silentLogger }, 1001, "EUR");
    expect(getVerdict(db, "m:501")).toBeNull();
    db.close();
  });
});
