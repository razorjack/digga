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
export function webkitTimeToIso(us: number | null): string | null {
  if (!us || us <= 0) return null;
  return new Date(us / 1000 - WEBKIT_EPOCH_OFFSET_MS).toISOString();
}

/** Firefox stores microseconds since the Unix epoch. */
export function firefoxTimeToIso(us: number | null): string | null {
  if (!us || us <= 0) return null;
  return new Date(us / 1000).toISOString();
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

export function discoverHistoryFiles(opts: {
  browser?: Browser;
  homeDir?: string;
  platform?: NodeJS.Platform;
}): HistoryFile[] {
  const home = opts.homeDir ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const browsers: Browser[] = opts.browser ? [opts.browser] : ["brave", "chrome", "firefox"];
  const out: HistoryFile[] = [];
  for (const browser of browsers) {
    if (browser === "firefox") {
      for (const root of firefoxRoots(home, platform)) {
        if (!fs.existsSync(root)) continue;
        for (const dir of fs.readdirSync(root)) {
          const file = path.join(root, dir, "places.sqlite");
          if (fs.existsSync(file)) out.push({ browser, profile: dir, path: file });
        }
      }
      continue;
    }
    for (const root of chromiumRoots(browser, home, platform)) {
      if (!fs.existsSync(root)) continue;
      for (const dir of fs.readdirSync(root)) {
        if (dir !== "Default" && !/^Profile \d+$/.test(dir)) continue;
        const file = path.join(root, dir, "History");
        if (fs.existsSync(file)) out.push({ browser, profile: dir, path: file });
      }
    }
  }
  return out;
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
  const dest = path.join(
    tempDir,
    `history-${Date.now()}-${path.basename(file).replace(/[^\w.-]/g, "_")}`,
  );
  try {
    fs.copyFileSync(file, dest);
    for (const suffix of ["-wal", "-journal"]) {
      if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, dest + suffix);
    }
  } catch (err) {
    throw new HistoryAccessError(file, err);
  }
  return dest;
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
      return rows.map((r) => ({
        url: r.url,
        title: r.title,
        visitCount: r.visit_count,
        lastVisit: firefoxTimeToIso(r.last_visit_date),
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
    return rows.map((r) => ({
      url: r.url,
      title: r.title,
      visitCount: r.visit_count,
      lastVisit: webkitTimeToIso(r.last_visit_time),
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
  const out = new Map<string, SeenKey>();
  for (const u of urls) {
    const ref = parseDiscogsUrl(u.url);
    if (!ref) continue;
    const key =
      ref.kind === "master" ? masterKey(ref.id) : (resolveKey(ref.id) ?? releaseKey(ref.id));
    const releaseId = ref.kind === "release" ? ref.id : null;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, { key, releaseId, lastVisit: u.lastVisit, visits: u.visitCount });
      continue;
    }
    prev.visits += u.visitCount;
    if (prev.releaseId === null && releaseId !== null) prev.releaseId = releaseId;
    if (u.lastVisit && (!prev.lastVisit || u.lastVisit > prev.lastVisit))
      prev.lastVisit = u.lastVisit;
  }
  return out;
}

export async function importHistory(
  deps: { db: Db; logger: Logger },
  opts: HistoryImportOptions,
  onProgress?: (p: HistoryImportProgress) => void,
): Promise<HistoryImportProgress & { files: number; sources: HistoryFile[] }> {
  const sources: HistoryFile[] = opts.path
    ? [
        {
          browser: opts.browser ?? "brave",
          profile: path.basename(path.dirname(opts.path)),
          path: opts.path,
        },
      ]
    : discoverHistoryFiles({
        browser: opts.browser,
        homeDir: opts.homeDir,
        platform: opts.platform,
      });
  if (sources.length === 0) {
    throw new Error(
      `No browser history found for ${opts.browser ?? "brave/chrome/firefox"}; pass --path to the History file.`,
    );
  }
  const progress: HistoryImportProgress = {
    files: 0,
    urls: 0,
    discogsUrls: 0,
    keys: 0,
    verdictsWritten: 0,
  };
  const all: HistoryUrl[] = [];
  for (const src of sources) {
    if (opts.signal?.aborted) break;
    deps.logger.info(`reading ${src.browser} ${src.profile}: ${src.path}`);
    const copy = copyHistoryFile(src.path, opts.tempDir);
    try {
      const urls = readHistoryUrls(copy, src.browser);
      all.push(...urls);
      progress.files += 1;
      progress.urls += urls.length;
    } finally {
      for (const suffix of ["", "-wal", "-journal"]) fs.rmSync(copy + suffix, { force: true });
    }
    onProgress?.({ ...progress });
  }
  const keys = historyUrlsToSeenKeys(all, (id) => getRelease(deps.db, id)?.triageKey ?? null);
  progress.discogsUrls = all.filter((u) => parseDiscogsUrl(u.url) !== null).length;
  progress.keys = keys.size;
  deps.db.transaction(() => {
    for (const seen of keys.values()) {
      const { written } = applySeedVerdict(deps.db, {
        key: seen.key,
        status: "seen",
        source: "seed:history",
        releaseId: seen.releaseId,
        decidedAt: seen.lastVisit ?? undefined,
      });
      if (written) progress.verdictsWritten += 1;
    }
  })();
  onProgress?.({ ...progress });
  deps.logger.info(
    `history: ${progress.keys} keys from ${progress.discogsUrls} Discogs URLs, ${progress.verdictsWritten} verdicts written`,
  );
  return { ...progress, sources };
}
