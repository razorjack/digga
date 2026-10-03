import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import {
  finishDumpLoadRecord,
  forgetUnfinishedLoads,
  latestDumpLoad,
  startDumpLoadRecord,
} from "../src/server/db/dump-loads.ts";
import { createJob, getJob, updateJobProgress } from "../src/server/db/jobs.ts";
import {
  addUserVideo,
  getRelease,
  insertStubRelease,
  upsertRelease,
} from "../src/server/db/releases.ts";
import { dumpLoad, type DumpLoadJobOptions } from "../src/server/jobs/dump-load.ts";
import { countRemaining, queryQueue } from "../src/server/queue/query.ts";
import { computeStats } from "../src/server/stats.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { jobProgress } from "../src/shared/job-display.ts";
import { newRecordsScope } from "../src/shared/scope.ts";
import type { DumpLoadProgress } from "../src/shared/types.ts";
import { FIXTURE_GZ, filters, silentLogger } from "./helpers.ts";

const load = (
  db: ReturnType<typeof openDb>,
  overrides: Partial<DumpLoadJobOptions> = {},
  onProgress?: (progress: DumpLoadProgress) => void,
) =>
  dumpLoad(
    { db, logger: silentLogger },
    { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null, coverage: false, ...overrides },
    onProgress,
  );

const addedBy = (db: ReturnType<typeof openDb>, id: number) =>
  db.prepare("SELECT id FROM releases WHERE added_by_load = ? ORDER BY id").pluck().all(id);

describe("recorded dump loads", () => {
  it("record the releases each load brings into the universe", async () => {
    const db = openDb(":memory:");
    const progress: DumpLoadProgress[] = [];
    const first = await load(db, {}, (update) => progress.push(update));
    expect(first.load).toMatchObject({ added: 5, coverage: 0, missing: 0 });
    expect(addedBy(db, first.load!.id)).toEqual([1001, 1002, 1003, 1004, 1006]);
    expect(progress.at(-1)).toMatchObject({ phase: "done", added: 5, missing: 0 });

    const again = await load(db);
    expect(again.load).toMatchObject({ added: 0, missing: 0 });
    expect(addedBy(db, first.load!.id)).toHaveLength(5);
    expect(latestDumpLoad(db)?.id).toBe(again.load!.id);
    db.close();
  });

  it("count the releases a load did not find, unless a limit stopped it", async () => {
    const db = openDb(":memory:");
    await load(db);
    const narrower = await load(db, { styles: ["Jungle"] });
    // Only 1004 is tagged Jungle; the other four stay in the library.
    expect(narrower.load).toMatchObject({ added: 0, missing: 4 });
    expect(getRelease(db, 1001)?.inUniverse).toBe(true);
    const limited = await load(db, { limit: 1 });
    expect(limited.load?.missing).toBeNull();
    db.close();
  });

  it("give a stub the load that brings it into the universe", async () => {
    const db = openDb(":memory:");
    await load(db);
    const techno = (await load(db, { styles: ["Techno"], dryRun: true })).load;
    expect(techno).toBeNull();
    insertStubRelease(db, { ...stubOf(1005) });
    const covered = await load(db, { labelIds: [77] });
    expect(covered.load).toMatchObject({ added: 1, coverage: 1 });
    expect(addedBy(db, covered.load!.id)).toEqual([1005]);
    db.close();
  });

  it("credit a finished load with what an unfinished one added", () => {
    const db = openDb(":memory:");
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const cancelled = startDumpLoadRecord(db, { file: "a.xml.gz", dumpDate: null, startedAt });
    upsertRelease(db, { ...stubOf(1005), inUniverse: true }, cancelled);
    const next = startDumpLoadRecord(db, { file: "b.xml.gz", dumpDate: null, startedAt });
    // The next load finds the release again; it was already in the universe, so it keeps its adder.
    upsertRelease(db, { ...stubOf(1005), inUniverse: true }, next);
    const summary = finishDumpLoadRecord(db, next, {
      coverage: 0,
      complete: true,
      finishedAt: new Date().toISOString(),
    });
    expect(summary).toMatchObject({ added: 1, missing: 0 });
    expect(db.prepare("SELECT id FROM dump_loads").pluck().all()).toEqual([next]);
    db.close();
  });

  it("forget an unfinished load, keeping the releases with the user's data as stubs", () => {
    const db = openDb(":memory:");
    const startedAt = new Date().toISOString();
    const unfinished = startDumpLoadRecord(db, { file: "a.xml.gz", dumpDate: null, startedAt });
    upsertRelease(db, { ...stubOf(1005), inUniverse: true }, unfinished);
    upsertRelease(db, { ...stubOf(1006), inUniverse: true }, unfinished);
    addUserVideo(db, 1005, {
      videoId: "pastedvid01",
      src: "https://www.youtube.com/watch?v=pastedvid01",
      title: "",
      matchedPosition: null,
    });

    expect(forgetUnfinishedLoads(db)).toBe(1);
    expect(getRelease(db, 1006)).toBeNull();
    expect(getRelease(db, 1005)?.inUniverse).toBe(false);
    expect(db.prepare("SELECT video_id FROM user_videos").pluck().all()).toEqual(["pastedvid01"]);
    db.close();
  });

  it("make the new records a scope that Triage and the stats offer", async () => {
    const db = openDb(":memory:");
    const first = await load(db);
    const scope = { kind: "load" as const, id: first.load!.id };
    const queued = queryQueue(db, {
      filters: filters({}),
      strategy: "label_sweep",
      limit: 10,
      scope,
    });
    expect(queued.map((item) => item.id)).toEqual([1006, 1001]);
    expect(countRemaining(db, filters({}), scope)).toBe(2);

    const stats = computeStats(db, DEFAULT_CONFIG);
    expect(stats.dump.lastLoad).toMatchObject({ id: first.load!.id, added: 5, toDig: 2 });
    const now = new Date("2026-10-02T12:00:00Z");
    expect(newRecordsScope({ ...stats.dump.lastLoad!, dumpDate: "2026-10-01" }, now)).toEqual({
      kind: "load",
      id: first.load!.id,
      name: "added from the 1 Oct dump",
      records: 2,
    });
    expect(newRecordsScope({ ...stats.dump.lastLoad!, toDig: 0 })).toBeNull();
    db.close();
  });

  it("say in the jobs panel what the load added and did not find", () => {
    const db = openDb(":memory:");
    const job = createJob(db, "dump_load");
    updateJobProgress(db, job.id, {
      phase: "done",
      scanned: 19_417_067,
      matched: 71_699,
      coverage: 312,
      upserted: 72_011,
      elapsedSeconds: 807,
      bytesRead: 100,
      totalBytes: 100,
      added: 580,
      missing: 3,
    });
    expect(jobProgress(getJob(db, job.id)!).text).toBe(
      "scanned 19,417,067, matched 71,699, 312 more for their label or artist, 580 new, 3 not found",
    );
    db.close();
  });
});

function stubOf(id: number) {
  return {
    id,
    masterId: null,
    isMainRelease: false,
    title: `Release ${id}`,
    artists: [],
    artistDisplay: "",
    labels: [{ id: 77, name: "Renegade Hardware", catno: "" }],
    labelName: "Renegade Hardware",
    catno: null,
    year: 1999,
    releasedRaw: "1999",
    country: null,
    formats: [],
    isVinyl: true,
    genres: [],
    styles: ["Techno"],
    inUniverse: false,
    triageKey: `r:${id}`,
    tracks: [],
    videos: [],
  };
}
