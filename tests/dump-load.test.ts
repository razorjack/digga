import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { getRelease, getTracks, getVideos } from "../src/server/db/releases.ts";
import { applyEnrichment } from "../src/server/jobs/enrich.ts";
import { fixtureDb } from "./helpers.ts";
import { dumpReleaseToWrite } from "../tools/dump/convert.ts";
import { loadDump, matchesUniverse, dumpDateFromFilename } from "../tools/dump/load.ts";
import { iterateReleases } from "../tools/dump/parse.ts";
import type { DumpRelease } from "../tools/dump/types.ts";

const FIXTURE_GZ = fileURLToPath(new URL("../fixtures/releases-sample.xml.gz", import.meta.url));
const FIXTURE_XML = fileURLToPath(new URL("../fixtures/releases-sample.xml", import.meta.url));

async function parseAll(file: string): Promise<DumpRelease[]> {
  const out: DumpRelease[] = [];
  const { openDumpInput } = await import("../tools/dump/load.ts");
  for await (const rel of iterateReleases(openDumpInput(file, process.stdin).stream)) out.push(rel);
  return out;
}

describe("dump parser", () => {
  it("parses every release in the fixture with the expected shape", async () => {
    const releases = await parseAll(FIXTURE_GZ);
    expect(releases.map((r) => r.id)).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
    const first = releases[0]!;
    expect(first.title).toBe("Wormhole");
    expect(first.masterId).toBe(501);
    expect(first.isMainRelease).toBe(true);
    expect(first.artists).toEqual([
      { id: 11, name: "Ed Rush (2)", anv: "", join: "&" },
      { id: 12, name: "Optical", anv: "", join: "" },
    ]);
    expect(first.labels).toEqual([{ id: 77, name: "Renegade Hardware", catno: "RH 20" }]);
    expect(first.formats).toEqual([
      { name: "Vinyl", qty: 2, text: "", descriptions: ['12"', "33 ⅓ RPM"] },
    ]);
    expect(first.styles).toEqual(["Drum n Bass", "Techstep"]);
    expect(first.country).toBe("UK");
    expect(first.released).toBe("2000-05-01");
    expect(first.tracklist.map((t) => t.position)).toEqual(["A1", "A2", "B1"]);
    expect(first.tracklist[1]!.artists).toEqual([]);
    expect(first.videos).toHaveLength(2);
    expect(first.videos[0]).toMatchObject({
      src: "https://www.youtube.com/watch?v=aaaaaaaaaa1",
      duration: 372,
      embed: true,
    });
  });

  it("reads plain xml too and keeps track-level artists", async () => {
    const releases = await parseAll(FIXTURE_XML);
    const sampler = releases.find((r) => r.id === 1003)!;
    expect(sampler.released).toBeNull();
    expect(sampler.masterId).toBeNull();
    expect(sampler.tracklist[0]!.artists[0]!.name).toBe("Konflict");
    const konflict = releases.find((r) => r.id === 1006)!;
    expect(konflict.artists[0]!.anv).toBe("Konflikt");
    expect(konflict.videos[1]!.embed).toBe(false);
  });
});

describe("matchesUniverse", () => {
  const base: DumpRelease = {
    id: 1,
    status: "Accepted",
    masterId: null,
    isMainRelease: false,
    title: "",
    artists: [{ id: 5, name: "A", anv: "", join: "" }],
    labels: [{ id: 9, name: "L", catno: "" }],
    formats: [],
    genres: [],
    styles: ["Drum n Bass"],
    country: null,
    released: "2000",
    tracklist: [],
    videos: [],
  };
  it("filters by style and wide year window, letting unknown years through", () => {
    expect(matchesUniverse(base, { styles: ["Drum n Bass"], loadYears: [1994, 2008] })).toBe(true);
    expect(
      matchesUniverse(
        { ...base, released: "1990" },
        { styles: ["Drum n Bass"], loadYears: [1994, 2008] },
      ),
    ).toBe(false);
    expect(
      matchesUniverse(
        { ...base, released: null },
        { styles: ["Drum n Bass"], loadYears: [1994, 2008] },
      ),
    ).toBe(true);
    expect(
      matchesUniverse(
        { ...base, styles: ["Techno"] },
        { styles: ["Drum n Bass"], loadYears: null },
      ),
    ).toBe(false);
    expect(
      matchesUniverse({ ...base, released: "1990" }, { styles: ["Drum n Bass"], loadYears: null }),
    ).toBe(true);
  });
});

describe("the coverage pass in a load", () => {
  const criteria = { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null };

  it("keeps a release in another style on a label mostly in the styles", async () => {
    const db = openDb(":memory:");
    // 1005 is Techno on Renegade Hardware (77), which has four Drum n Bass releases.
    const result = await loadDump(db, { ...criteria, labelIds: [77] });
    expect(result).toMatchObject({ matched: 5, coverage: 1, upserted: 6 });
    expect(getRelease(db, 1005)?.styles).toEqual(["Techno"]);
    db.close();
  });

  it("keeps nothing for an artist without releases in the styles, or after a limit", async () => {
    const db = openDb(":memory:");
    // Surgeon (41) has only the Techno release.
    const byArtist = await loadDump(db, { ...criteria, artistIds: [41] });
    expect(byArtist).toMatchObject({ matched: 5, coverage: 0 });
    const limited = await loadDump(db, { ...criteria, labelIds: [77], limit: 5 });
    expect(limited).toMatchObject({ matched: 5, coverage: 0 });
    expect(getRelease(db, 1005)).toBeNull();
    db.close();
  });
});

describe("dumpReleaseToWrite", () => {
  it("keeps dump and API matches aligned after duplicate and invalid videos", async () => {
    const release = (await parseAll(FIXTURE_GZ))[0]!;
    const first = release.videos[0]!;
    const last = release.videos[1]!;
    release.videos = [first, { ...first, src: "invalid" }, first, last];
    const videos = dumpReleaseToWrite(release).videos;
    expect(videos.map((video) => [video.videoId, video.matchedPosition])).toEqual([
      ["aaaaaaaaaa1", "A1"],
      ["aaaaaaaaaa2", "B1"],
    ]);

    const db = await fixtureDb();
    try {
      applyEnrichment(db, release.id, {
        id: release.id,
        title: release.title,
        videos: release.videos.map((video) => ({
          uri: video.src,
          title: video.title,
          duration: video.duration ?? undefined,
          embed: video.embed,
        })),
      });
      expect(getVideos(db, release.id).map(({ releaseId: _releaseId, ...video }) => video)).toEqual(
        videos,
      );
    } finally {
      db.close();
    }
  });

  it("derives display, year, vinyl flag, triage key, heard keys and matched videos", async () => {
    const releases = await parseAll(FIXTURE_GZ);
    const w = dumpReleaseToWrite(releases[0]!);
    expect(w.artistDisplay).toBe("Ed Rush & Optical");
    expect(w.year).toBe(2000);
    expect(w.isVinyl).toBe(true);
    expect(w.triageKey).toBe("m:501");
    expect(w.labelName).toBe("Renegade Hardware");
    expect(w.catno).toBe("RH 20");
    expect(w.tracks[0]!.heardKey).toBe("ed rush and optical - wormhole");
    expect(w.tracks[0]!.durationSeconds).toBe(372);
    expect(w.videos.map((v) => [v.videoId, v.matchedPosition])).toEqual([
      ["aaaaaaaaaa1", "A1"],
      ["aaaaaaaaaa2", "B1"],
    ]);
    const sampler = dumpReleaseToWrite(releases[2]!);
    expect(sampler.triageKey).toBe("r:1003");
    expect(sampler.year).toBeNull();
    expect(sampler.tracks[0]!.heardKey).toBe("konflict - messiah");
    expect(sampler.videos).toHaveLength(1);
    const konflict = dumpReleaseToWrite(releases[5]!);
    expect(konflict.artistDisplay).toBe("Konflikt");
    expect(konflict.videos.map((v) => v.matchedPosition)).toEqual(["A", null]);
  });
});

describe("loadDump", () => {
  it("upserts matching releases into a fresh database", async () => {
    const db = openDb(":memory:");
    const progress: number[] = [];
    const result = await loadDump(
      db,
      { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: [1994, 2008], progressEvery: 2 },
      { onProgress: (p) => progress.push(p.scanned) },
    );
    expect(result).toMatchObject({ scanned: 6, matched: 5, upserted: 5, dryRun: false });
    expect(progress).toEqual([2, 4, 6, 6]);
    const ids = (db.prepare("SELECT id FROM releases ORDER BY id").all() as { id: number }[]).map(
      (r) => r.id,
    );
    expect(ids).toEqual([1001, 1002, 1003, 1004, 1006]);
    const rel = getRelease(db, 1001)!;
    expect(rel.inUniverse).toBe(true);
    expect(rel.styles).toEqual(["Drum n Bass", "Techstep"]);
    expect(getTracks(db, 1001)).toHaveLength(3);
    expect(getVideos(db, 1001).map((v) => v.matchedPosition)).toEqual(["A1", "B1"]);
    expect(getVideos(db, 1003).map((v) => v.videoId)).toEqual(["bbbbbbbbbb1"]);
    db.close();
  });

  it("honours limit, dry-run and re-runs idempotently", async () => {
    const db = openDb(":memory:");
    const dry = await loadDump(db, {
      file: FIXTURE_GZ,
      styles: ["Drum n Bass"],
      loadYears: null,
      dryRun: true,
    });
    expect(dry).toMatchObject({ matched: 5, upserted: 0, dryRun: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM releases").get()).toEqual({ n: 0 });
    const limited = await loadDump(db, {
      file: FIXTURE_GZ,
      styles: ["Drum n Bass"],
      loadYears: null,
      limit: 2,
    });
    expect(limited.matched).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM releases").get()).toEqual({ n: 2 });
    await loadDump(db, { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null });
    await loadDump(db, { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM releases").get()).toEqual({ n: 5 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE release_id = 1001").get()).toEqual({
      n: 3,
    });
    db.close();
  });

  it("parses the dump date from the file name", () => {
    expect(dumpDateFromFilename("/x/discogs_20250901_releases.xml.gz")).toBe("2025-09-01");
    expect(dumpDateFromFilename("releases-sample.xml.gz")).toBeNull();
    expect(fs.existsSync(FIXTURE_GZ)).toBe(true);
  });
});
