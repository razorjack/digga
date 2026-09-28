import type { HistoryImportProgress } from "../../shared/types.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "../../shared/api.ts";
import { parseDiscogsUrl } from "../../shared/discogs-urls.ts";
import { masterKey, releaseKey } from "../../shared/triage-key.ts";
import { type Db, openDb } from "../db/db.ts";
import { getRelease } from "../db/releases.ts";
import { applySeedVerdict } from "../db/verdicts.ts";
import type { Logger } from "../logger.ts";

/**
 * The only module that touches browser profile files. Brave on macOS is the primary
 * target; Chrome shares the schema and Firefox is best effort.
 */

export interface HistoryFile {
  browser: Browser;
  profile: string;
  path: string;
}

export interface HistoryUrl {
  url: string;
  title: string | null;
  visitCount: number;
  /** ISO timestamp of the last visit, null when unknown. */
  lastVisit: string | null;
}

export interface HistoryImportOptions {
  browser?: Browser;
  path?: string;
  tempDir: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
}

const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

/** Chromium stores microseconds since 1601-01-01. */
export function webkitTimeToIso(microseconds: number | null): string | null {
  if (!microseconds || microseconds <= 0) return null;
  return new Date(microseconds / 1000 - WEBKIT_EPOCH_OFFSET_MS).toISOString();
}

/** Firefox stores microseconds since the Unix epoch. */
export function firefoxTimeToIso(microseconds: number | null): string | null {
  if (!microseconds || microseconds <= 0) return null;
  return new Date(microseconds / 1000).toISOString();
}

function chromiumRoots(
  browser: "brave" | "chrome",
  home: string,
  platform: NodeJS.Platform,
): string[] {
  const mac = browser === "brave" ? "BraveSoftware/Brave-Browser" : "Google/Chrome";
  const linux = browser === "brave" ? "BraveSoftware/Brave-Browser" : "google-chrome";
  const win =
    browser === "brave" ? "BraveSoftware/Brave-Browser/User Data" : "Google/Chrome/User Data";
  if (platform === "darwin") return [path.join(home, "Library", "Application Support", mac)];
  if (platform === "win32") return [path.join(home, "AppData", "Local", win)];
  return [path.join(home, ".config", linux)];
}

function firefoxRoots(home: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin")
    return [path.join(home, "Library", "Application Support", "Firefox", "Profiles")];
  if (platform === "win32")
    return [path.join(home, "AppData", "Roaming", "Mozilla", "Firefox", "Profiles")];
  return [
    path.join(home, ".mozilla", "firefox"),
    path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
  ];
}

export function discoverHistoryFiles(options: {
  browser?: Browser;
  homeDir?: string;
  platform?: NodeJS.Platform;
}): HistoryFile[] {
  const home = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const browsers: Browser[] = options.browser ? [options.browser] : ["brave", "chrome", "firefox"];
  return browsers.flatMap((browser) => {
    const roots =
      browser === "firefox" ? firefoxRoots(home, platform) : chromiumRoots(browser, home, platform);
    return roots.flatMap((root) => profileHistoryFiles(root, browser));
  });
}

function profileHistoryFiles(root: string, browser: Browser): HistoryFile[] {
  if (!fs.existsSync(root)) return [];
  const profiles = fs
    .readdirSync(root)
    .filter(
      (profile) => browser === "firefox" || profile === "Default" || /^Profile \d+$/.test(profile),
    );
  const filename = browser === "firefox" ? "places.sqlite" : "History";
  return profiles
    .map((profile) => ({ browser, profile, path: path.join(root, profile, filename) }))
    .filter((source) => fs.existsSync(source.path));
}

export class HistoryAccessError extends Error {
  constructor(file: string, cause: unknown) {
    super(
      `Cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        "On macOS grant your terminal Full Disk Access (System Settings > Privacy & Security), or pass --path to a copy.",
    );
    this.name = "HistoryAccessError";
  }
}

/** Copies the (possibly locked) profile database into the temp dir and returns the copy path. */
export function copyHistoryFile(file: string, tempDir: string): string {
  fs.mkdirSync(tempDir, { recursive: true });
  const destination = path.join(
    tempDir,
    `history-${Date.now()}-${path.basename(file).replace(/[^\w.-]/g, "_")}`,
  );
  try {
    fs.copyFileSync(file, destination);
    for (const suffix of ["-wal", "-journal"]) {
      if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, destination + suffix);
    }
  } catch (err) {
    throw new HistoryAccessError(file, err);
  }
  return destination;
}

export function readHistoryUrls(copiedFile: string, browser: Browser): HistoryUrl[] {
  const db = openDb(copiedFile, { readonly: true, foreign: true });
  try {
    if (browser === "firefox") {
      const rows = db
        .prepare(
          "SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE url LIKE '%discogs.com%'",
        )
        .all() as {
        url: string;
        title: string | null;
        visit_count: number;
        last_visit_date: number | null;
      }[];
      return rows.map((row) => ({
        url: row.url,
        title: row.title,
        visitCount: row.visit_count,
        lastVisit: firefoxTimeToIso(row.last_visit_date),
      }));
    }
    const rows = db
      .prepare(
        "SELECT url, title, visit_count, last_visit_time FROM urls WHERE url LIKE '%discogs.com%'",
      )
      .all() as {
      url: string;
      title: string | null;
      visit_count: number;
      last_visit_time: number | null;
    }[];
    return rows.map((row) => ({
      url: row.url,
      title: row.title,
      visitCount: row.visit_count,
      lastVisit: webkitTimeToIso(row.last_visit_time),
    }));
  } finally {
    db.close();
  }
}

export interface SeenKey {
  key: string;
  releaseId: number | null;
  lastVisit: string | null;
  visits: number;
}

/**
 * Pure aggregation: master URLs mark m:{id}; release URLs mark the release's triage key
 * when the release is known (resolveKey), else r:{id}.
 */
export function historyUrlsToSeenKeys(
  urls: HistoryUrl[],
  resolveKey: (releaseId: number) => string | null,
): Map<string, SeenKey> {
  const seen = new Map<string, SeenKey>();
  for (const url of urls) {
    const ref = parseDiscogsUrl(url.url);
    if (!ref) continue;
    const key =
      ref.kind === "master" ? masterKey(ref.id) : (resolveKey(ref.id) ?? releaseKey(ref.id));
    const releaseId = ref.kind === "release" ? ref.id : null;
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, { key, releaseId, lastVisit: url.lastVisit, visits: url.visitCount });
      continue;
    }
    previous.visits += url.visitCount;
    if (previous.releaseId === null && releaseId !== null) previous.releaseId = releaseId;
    if (url.lastVisit && (!previous.lastVisit || url.lastVisit > previous.lastVisit))
      previous.lastVisit = url.lastVisit;
  }
  return seen;
}

export async function importHistory(
  deps: { db: Db; logger: Logger },
  options: HistoryImportOptions,
  onProgress?: (p: HistoryImportProgress) => void,
): Promise<HistoryImportProgress & { files: number; sources: HistoryFile[] }> {
  const sources = historySources(options);
  const progress: HistoryImportProgress = {
    files: 0,
    urls: 0,
    discogsUrls: 0,
    keys: 0,
    verdictsWritten: 0,
  };
  const all: HistoryUrl[] = [];
  for (const source of sources) {
    if (options.signal?.aborted) break;
    deps.logger.info(`reading ${source.browser} ${source.profile}: ${source.path}`);
    const urls = readProfileHistory(source, options.tempDir);
    all.push(...urls);
    progress.files += 1;
    progress.urls += urls.length;
    onProgress?.({ ...progress });
  }
  const keys = historyUrlsToSeenKeys(all, (id) => getRelease(deps.db, id)?.triageKey ?? null);
  progress.discogsUrls = all.filter((url) => parseDiscogsUrl(url.url) !== null).length;
  progress.keys = keys.size;
  progress.verdictsWritten = applySeenKeys(deps.db, keys);
  onProgress?.({ ...progress });
  deps.logger.info(
    `history: ${progress.keys} keys from ${progress.discogsUrls} Discogs URLs, ${progress.verdictsWritten} verdicts written`,
  );
  return { ...progress, sources };
}

function historySources(options: HistoryImportOptions): HistoryFile[] {
  const sources: HistoryFile[] = options.path
    ? [
        {
          browser: options.browser ?? "brave",
          profile: path.basename(path.dirname(options.path)),
          path: options.path,
        },
      ]
    : discoverHistoryFiles({
        browser: options.browser,
        homeDir: options.homeDir,
        platform: options.platform,
      });
  if (sources.length === 0) {
    throw new Error(
      `No browser history found for ${options.browser ?? "brave/chrome/firefox"}; pass --path to the History file.`,
    );
  }
  return sources;
}

function applySeenKeys(db: Db, keys: Map<string, SeenKey>): number {
  let writtenCount = 0;
  db.transaction(() => {
    for (const seen of keys.values()) {
      const { written } = applySeedVerdict(db, {
        key: seen.key,
        status: "seen",
        source: "seed:history",
        releaseId: seen.releaseId,
        decidedAt: seen.lastVisit ?? undefined,
      });
      if (written) writtenCount += 1;
    }
  })();
  return writtenCount;
}

function readProfileHistory(source: HistoryFile, tempDir: string): HistoryUrl[] {
  const copy = copyHistoryFile(source.path, tempDir);
  try {
    return readHistoryUrls(copy, source.browser);
  } finally {
    for (const suffix of ["", "-wal", "-journal"]) fs.rmSync(copy + suffix, { force: true });
  }
}
