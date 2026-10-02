import fs from "node:fs";
import path from "node:path";
import { openDb } from "../../../src/server/db/db.ts";
import type { Browser } from "../../../src/shared/api.ts";
import type { FixtureRelease } from "./catalogue.ts";

/**
 * Browser history databases in a test's fake home, where the setup and the history import look
 * for them (docs/e2e/FIXTURES.md#browser-history). The folders are written out here, not taken
 * from the importer, so a change to where Digga looks fails the tests.
 */

/** One row of a browser's history. */
export interface HistoryVisit {
  url: string;
  title: string;
  visits: number;
  /** ISO time of the last visit. */
  lastVisit: string;
}

/** The visits one browser's history holds, in its first profile. */
export interface BrowserHistory {
  browser: Browser;
  visits: HistoryVisit[];
}

/** A visit to the release's page on discogs.com, titled as Discogs titles it. */
export function releaseVisit(release: FixtureRelease, lastVisit: string): HistoryVisit {
  const slug = `${release.artists.join(" ")} ${release.title}`.replace(/[^\w]+/g, "-");
  return {
    url: `https://www.discogs.com/release/${release.id}-${slug}`,
    title: `${release.artists.join(", ")} - ${release.title} | Releases | Discogs`,
    visits: 2,
    lastVisit,
  };
}

/** The folder Digga lists a browser's profiles from, under the home folder, per platform. */
export function browserFolder(
  home: string,
  browser: Browser,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(home, ...BROWSER_FOLDERS[platformFamily(platform)][browser]);
}

/** Writes the browser's history database into its first profile; returns the file. */
export function writeBrowserHistory(home: string, history: BrowserHistory): string {
  const profile = history.browser === "firefox" ? "e2e.default-release" : "Default";
  const file = path.join(
    browserFolder(home, history.browser),
    profile,
    history.browser === "firefox" ? "places.sqlite" : "History",
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file, { foreign: true });
  try {
    if (history.browser === "firefox") writeFirefoxPlaces(db, history.visits);
    else writeChromiumUrls(db, history.visits);
  } finally {
    db.close();
  }
  return file;
}

/**
 * Takes every permission from the browser's folder, as macOS does without Full Disk Access, so
 * Digga finds the folder and cannot list it; returns the function that gives them back, which
 * must run before the test's folder is deleted.
 */
export function lockBrowserFolder(home: string, browser: Browser): () => void {
  const folder = browserFolder(home, browser);
  fs.mkdirSync(folder, { recursive: true });
  const { mode } = fs.statSync(folder);
  fs.chmodSync(folder, 0o000);
  return () => fs.chmodSync(folder, mode);
}

type Db = ReturnType<typeof openDb>;

const BROWSER_FOLDERS: Record<"darwin" | "win32" | "linux", Record<Browser, string[]>> = {
  darwin: {
    brave: ["Library", "Application Support", "BraveSoftware", "Brave-Browser"],
    chrome: ["Library", "Application Support", "Google", "Chrome"],
    firefox: ["Library", "Application Support", "Firefox", "Profiles"],
  },
  win32: {
    brave: ["AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data"],
    chrome: ["AppData", "Local", "Google", "Chrome", "User Data"],
    firefox: ["AppData", "Roaming", "Mozilla", "Firefox", "Profiles"],
  },
  linux: {
    brave: [".config", "BraveSoftware", "Brave-Browser"],
    chrome: [".config", "google-chrome"],
    firefox: [".mozilla", "firefox"],
  },
};

function platformFamily(platform: NodeJS.Platform): keyof typeof BROWSER_FOLDERS {
  if (platform === "darwin" || platform === "win32") return platform;
  return "linux";
}

/** Chromium keeps microseconds since 1601-01-01. */
const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

function writeChromiumUrls(db: Db, visits: HistoryVisit[]): void {
  db.exec(
    "CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)",
  );
  const insert = db.prepare(
    "INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)",
  );
  for (const visit of visits) {
    const webkitTime = (Date.parse(visit.lastVisit) + WEBKIT_EPOCH_OFFSET_MS) * 1000;
    insert.run(visit.url, visit.title, visit.visits, webkitTime);
  }
}

/** Firefox keeps microseconds since the Unix epoch. */
function writeFirefoxPlaces(db: Db, visits: HistoryVisit[]): void {
  db.exec(
    "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, rev_host LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, typed INTEGER DEFAULT 0 NOT NULL, frecency INTEGER DEFAULT -1 NOT NULL, last_visit_date INTEGER)",
  );
  const insert = db.prepare(
    "INSERT INTO moz_places (url, title, visit_count, last_visit_date) VALUES (?, ?, ?, ?)",
  );
  for (const visit of visits)
    insert.run(visit.url, visit.title, visit.visits, Date.parse(visit.lastVisit) * 1000);
}
