import fs from "node:fs";
import path from "node:path";
import {
  BROWSERS,
  type HistoryBrowser,
  type SetupCatalogue,
  type SetupResponse,
} from "../shared/api.ts";
import type { AppContext } from "./context.ts";
import { latestDumpLoad } from "./db/dump-loads.ts";
import { tallySeedReleases } from "./db/seed-tally.ts";
import type { DataDump, DataDumpClient } from "./discogs/data-dumps.ts";
import { discoverHistoryFiles } from "./importers/history.ts";
import { SPARE_BYTES } from "./jobs/dump-download.ts";

/** A new dump appears once a month; the listing is read again after an hour. */
const LISTING_TTL_MS = 60 * 60 * 1000;
const LISTING_TIMEOUT_MS = 20_000;

const listings = new WeakMap<DataDumpClient, { dump: DataDump; readAt: number }>();

/** What the first run shows: whether it is needed, the catalogue to fetch, and suggestions. */
export async function readSetup(context: AppContext): Promise<SetupResponse> {
  return {
    needed: latestDumpLoad(context.db) === null,
    catalogue: await readCatalogue(context),
    seeds: tallySeedReleases(context.db),
    browsers: historyBrowsers(),
  };
}

function historyBrowsers(): HistoryBrowser[] {
  return BROWSERS.flatMap((name): HistoryBrowser[] => {
    try {
      return discoverHistoryFiles({ browser: name }).length > 0 ? [{ name, readable: true }] : [];
    } catch (error) {
      return isAccessDenied(error) ? [{ name, readable: false }] : [];
    }
  });
}

function isAccessDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EACCES";
}

async function readCatalogue(context: AppContext): Promise<SetupCatalogue> {
  const dumpsDir = context.paths.dumpsDir;
  const freeBytes = await freeBytesNear(dumpsDir);
  try {
    const dump = await newestDump(context.dataDumps);
    const downloaded = fs.existsSync(path.join(dumpsDir, dump.file));
    return {
      newest: { date: dump.date, file: dump.file, bytes: dump.bytes, downloaded },
      error: null,
      dumpsDir,
      freeBytes,
      neededBytes: dump.bytes === null || downloaded ? null : dump.bytes + SPARE_BYTES,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { newest: null, error: message, dumpsDir, freeBytes, neededBytes: null };
  }
}

async function newestDump(client: DataDumpClient): Promise<DataDump> {
  const cached = listings.get(client);
  if (cached && Date.now() - cached.readAt < LISTING_TTL_MS) return cached.dump;
  const dump = await client.newestReleasesDump(AbortSignal.timeout(LISTING_TIMEOUT_MS));
  listings.set(client, { dump, readAt: Date.now() });
  return dump;
}

/** Free space on the disk of `dir`, asked of its nearest existing folder, since it may not exist yet. */
async function freeBytesNear(dir: string): Promise<number | null> {
  let existing = dir;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  try {
    const stats = await fs.promises.statfs(existing);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}
