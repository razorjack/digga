import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { getVerdict } from "../src/server/db/verdicts.ts";
import {
  discoverHistoryFiles,
  firefoxTimeToIso,
  historyUrlsToSeenKeys,
  importHistory,
  webkitTimeToIso,
} from "../src/server/importers/history.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

const WEBKIT_2024 = 13_348_540_800_000_000; // 2024-01-01T00:00:00Z

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-history-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeChromiumHistory(file: string, rows: [string, string, number, number][]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file, { foreign: true });
  db.exec(
    "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)",
  );
  const ins = db.prepare(
    "INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)",
  );
  for (const r of rows) ins.run(...r);
  db.close();
}

describe("time conversion", () => {
  it("converts WebKit and Firefox timestamps", () => {
    expect(webkitTimeToIso(WEBKIT_2024)).toBe("2024-01-01T00:00:00.000Z");
    expect(webkitTimeToIso(0)).toBeNull();
    expect(firefoxTimeToIso(1_704_067_200_000_000)).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("historyUrlsToSeenKeys", () => {
  it("maps masters, known releases and unknown releases, merging visits", () => {
    const keys = historyUrlsToSeenKeys(
      [
        {
          url: "https://www.discogs.com/master/501-X",
          title: null,
          visitCount: 2,
          lastVisit: "2024-01-01T00:00:00.000Z",
        },
        {
          url: "https://www.discogs.com/release/1002-Y",
          title: null,
          visitCount: 1,
          lastVisit: "2024-02-01T00:00:00.000Z",
        },
        {
          url: "https://www.discogs.com/release/4242",
          title: null,
          visitCount: 3,
          lastVisit: null,
        },
        { url: "https://www.discogs.com/artist/1-Z", title: null, visitCount: 9, lastVisit: null },
      ],
      (id) => (id === 1002 ? "m:501" : null),
    );
    expect([...keys.keys()]).toEqual(["m:501", "r:4242"]);
    expect(keys.get("m:501")).toEqual({
      key: "m:501",
      releaseId: 1002,
      lastVisit: "2024-02-01T00:00:00.000Z",
      visits: 3,
    });
  });
});

describe("importHistory", () => {
  it("imports a Chromium History file by path, marking keys as seen", async () => {
    const db = await fixtureDb();
    const file = path.join(tmp, "Default", "History");
    makeChromiumHistory(file, [
      ["https://www.discogs.com/release/1002-Ed-Rush-Optical-Wormhole", "Wormhole", 1, WEBKIT_2024],
      ["https://www.discogs.com/de/master/506", "Messiah", 2, WEBKIT_2024 + 1_000_000],
      ["https://www.discogs.com/Konflict-Messiah/release/777777", "Old", 1, WEBKIT_2024],
      ["https://www.discogs.com/artist/21-Konflict", "Artist", 5, WEBKIT_2024],
      ["https://www.youtube.com/watch?v=abc", "YT", 1, WEBKIT_2024],
    ]);
    const result = await importHistory(
      { db, logger: silentLogger },
      { path: file, browser: "brave", tempDir: path.join(tmp, "t") },
    );
    expect(result).toMatchObject({
      files: 1,
      urls: 4,
      discogsUrls: 3,
      keys: 3,
      verdictsWritten: 3,
    });
    expect(getVerdict(db, "m:501")).toMatchObject({
      status: "seen",
      source: "seed:history",
      releaseId: 1002,
      decidedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(getVerdict(db, "m:506")).toMatchObject({
      status: "seen",
      releaseId: null,
      decidedAt: "2024-01-01T00:00:01.000Z",
    });
    expect(getVerdict(db, "r:777777")!.status).toBe("seen");
    expect(fs.readdirSync(path.join(tmp, "t"))).toEqual([]);
    db.close();
  });

  it("reads Firefox places.sqlite", async () => {
    const db = await fixtureDb();
    const file = path.join(tmp, "places.sqlite");
    const places = openDb(file, { foreign: true });
    places.exec(
      "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)",
    );
    places
      .prepare(
        "INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)",
      )
      .run("https://www.discogs.com/release/1003", "Sampler", 1, 1_704_067_200_000_000);
    places.close();
    const result = await importHistory(
      { db, logger: silentLogger },
      { path: file, browser: "firefox", tempDir: path.join(tmp, "t") },
    );
    expect(result.keys).toBe(1);
    expect(getVerdict(db, "r:1003")!.decidedAt).toBe("2024-01-01T00:00:00.000Z");
    db.close();
  });

  it("discovers Brave and Chrome profiles on macOS", () => {
    const home = path.join(tmp, "home");
    const brave = path.join(
      home,
      "Library",
      "Application Support",
      "BraveSoftware",
      "Brave-Browser",
    );
    makeChromiumHistory(path.join(brave, "Default", "History"), []);
    makeChromiumHistory(path.join(brave, "Profile 2", "History"), []);
    fs.mkdirSync(path.join(brave, "Guest Profile"), { recursive: true });
    makeChromiumHistory(
      path.join(home, "Library", "Application Support", "Google", "Chrome", "Default", "History"),
      [],
    );
    const found = discoverHistoryFiles({ homeDir: home, platform: "darwin" });
    expect(found.map((f) => `${f.browser}:${f.profile}`)).toEqual([
      "brave:Default",
      "brave:Profile 2",
      "chrome:Default",
    ]);
    expect(
      discoverHistoryFiles({ homeDir: home, platform: "darwin", browser: "chrome" }),
    ).toHaveLength(1);
    expect(
      discoverHistoryFiles({ homeDir: home, platform: "darwin", browser: "firefox" }),
    ).toHaveLength(0);
  });

  it("fails clearly when nothing is found", async () => {
    const db = await fixtureDb();
    await expect(
      importHistory(
        { db, logger: silentLogger },
        { browser: "firefox", homeDir: tmp, platform: "darwin", tempDir: tmp },
      ),
    ).rejects.toThrow(/No browser history found/);
    db.close();
  });
});
