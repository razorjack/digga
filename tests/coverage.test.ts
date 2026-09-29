import { describe, expect, it } from "vite-plus/test";
import { getRelease } from "../src/server/db/releases.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { dumpLoad } from "../src/server/jobs/dump-load.ts";
import { coverageIds } from "../src/server/queue/coverage.ts";
import { CoverageTracker, MAX_OTHER_RELEASES } from "../tools/dump/coverage.ts";
import type { DumpRelease } from "../tools/dump/types.ts";
import { FIXTURE_GZ, fixtureDb, silentLogger } from "./helpers.ts";

function release(id: number, credits: { labels?: number[]; artists?: number[] } = {}): DumpRelease {
  return {
    id,
    status: "",
    title: `Release ${id}`,
    artists: (credits.artists ?? []).map((artistId) => ({
      id: artistId,
      name: `Artist ${artistId}`,
      anv: "",
      join: "",
    })),
    labels: (credits.labels ?? []).map((labelId) => ({
      id: labelId,
      name: `Label ${labelId}`,
      catno: "",
    })),
    formats: [],
    genres: [],
    styles: [],
    country: "",
    released: "",
    masterId: null,
    isMainRelease: false,
    tracklist: [],
    videos: [],
  };
}

const ids = (releases: DumpRelease[]) => releases.map((r) => r.id);

describe("the coverage pass", () => {
  it("keeps other styles on labels and artists whose releases are mostly in the styles", () => {
    const tracker = new CoverageTracker({ labelIds: [77], artistIds: [11] });
    tracker.countStyleRelease(release(1, { labels: [77] }));
    tracker.countStyleRelease(release(2, { labels: [77] }));
    tracker.offerOtherRelease(release(3, { labels: [77] }));
    tracker.offerOtherRelease(release(4, { artists: [11] }));
    tracker.offerOtherRelease(release(5, { labels: [99] }));

    const outcome = tracker.finish();
    // The artist has no release in the styles: none of their other releases qualify.
    expect(ids(outcome.releases)).toEqual([3]);
    expect(outcome.broad).toEqual(["artist Artist 11"]);
  });

  it("leaves out a label that releases mostly other styles", () => {
    const tracker = new CoverageTracker({ labelIds: [5, 6], artistIds: [] });
    tracker.countStyleRelease(release(1, { labels: [5, 6] }));
    for (const id of [2, 3, 4]) tracker.offerOtherRelease(release(id, { labels: [5] }));
    tracker.offerOtherRelease(release(5, { labels: [6] }));
    tracker.offerOtherRelease(release(6, { labels: [6] }));
    // One in four on label 5 is below a third; one in three on label 6 qualifies.
    const outcome = tracker.finish();
    expect(ids(outcome.releases)).toEqual([5, 6]);
    expect(outcome.broad).toEqual(["label Label 5"]);
  });

  it("stops holding the releases of a label past the cap, but keeps those another credit covers", () => {
    const tracker = new CoverageTracker({ labelIds: [1], artistIds: [2] });
    for (let id = 1; id <= 1000; id += 1) tracker.countStyleRelease(release(id, { labels: [1] }));
    tracker.countStyleRelease(release(2000, { artists: [2] }));
    tracker.offerOtherRelease(release(3000, { labels: [1], artists: [2] }));
    for (let id = 1; id <= MAX_OTHER_RELEASES + 1; id += 1)
      tracker.offerOtherRelease(release(10_000 + id, { labels: [1] }));

    const outcome = tracker.finish();
    expect(ids(outcome.releases)).toEqual([3000]);
    expect(outcome.broad).toEqual(["label Label 1"]);
  });

  it("is inactive without labels or artists", () => {
    expect(new CoverageTracker({ labelIds: [], artistIds: [] }).active).toBe(false);
    expect(new CoverageTracker({ labelIds: [1], artistIds: [] }).active).toBe(true);
  });
});

describe("the coverage labels and artists", () => {
  it("are those of records the user wants or owns, without Various", async () => {
    const db = await fixtureDb();
    expect(coverageIds(db)).toEqual({ labelIds: [], artistIds: [] });
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", releaseId: 1001 });
    const compilation = getRelease(db, 1003)!;
    upsertVerdict(db, {
      key: compilation.triageKey,
      status: "collection",
      source: "seed:collection",
    });
    upsertVerdict(db, { key: "m:504", status: "rejected", source: "triage", releaseId: 1004 });
    // Ed Rush (2) and Optical on 1001; the compilation's Various (194) is left out.
    expect(coverageIds(db)).toEqual({ labelIds: [77], artistIds: [11, 12] });
    db.close();
  });

  it("widen the next load when universe.coverage is on", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "candidate", source: "triage", releaseId: 1001 });
    const options = { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null };
    const without = await dumpLoad({ db, logger: silentLogger }, { ...options, coverage: false });
    expect(without.coverage).toBe(0);
    const covered = await dumpLoad({ db, logger: silentLogger }, { ...options, coverage: true });
    expect(covered.coverage).toBe(1);
    expect(getRelease(db, 1005)?.inUniverse).toBe(true);
    db.close();
  });
});
