import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatBytes } from "../../shared/display.ts";
import type { DumpDownloadProgress } from "../../shared/types.ts";
import { type DataDump, type DataDumpClient, DataDumpError } from "../discogs/data-dumps.ts";
import type { Logger } from "../logger.ts";

export interface DumpDownloadDeps {
  dumps: DataDumpClient;
  logger: Logger;
}

export interface DumpDownloadOptions {
  dumpsDir: string;
  signal?: AbortSignal;
  /** Free bytes in dumpsDir; the default asks the filesystem. */
  freeBytes?: (dir: string) => Promise<number>;
}

export interface DumpDownloadResult extends DumpDownloadProgress {
  file: string;
  /** Absolute path of the dump. */
  path: string;
}

/** Room left beside the dump, so a download cannot fill the disk to the last byte. */
export const SPARE_BYTES = 1024 ** 3;
const PROGRESS_EVERY_MS = 1000;

/**
 * Downloads the newest releases dump from data.discogs.com into the dumps folder, unless it is
 * there already. The file appears under its own name only once its SHA-256 matches the one
 * Discogs publishes, so a file with a dump's name is always a whole dump.
 */
export async function downloadDump(
  deps: DumpDownloadDeps,
  options: DumpDownloadOptions,
  onProgress?: (progress: DumpDownloadProgress) => void,
): Promise<DumpDownloadResult> {
  const { signal } = options;
  onProgress?.({ ...emptyProgress(), phase: "finding" });
  const dump = await deps.dumps.newestReleasesDump(signal);
  const target = path.join(options.dumpsDir, dump.file);
  if (fs.existsSync(target)) {
    const bytes = fs.statSync(target).size;
    const done = { ...doneProgress(dump, bytes), alreadyDownloaded: true };
    onProgress?.(done);
    deps.logger.info(`${dump.file} is downloaded already`);
    return { ...done, file: dump.file, path: target };
  }

  const checksum = await deps.dumps.checksum(dump, signal);
  const download = await deps.dumps.download(dump, signal);
  await ensureRoom(options, download.bytes);
  deps.logger.info(
    `downloading ${dump.file}${download.bytes ? ` (${formatBytes(download.bytes)})` : ""}`,
  );
  const bytes = await saveVerified(download, { target, checksum, dump }, (receivedBytes) =>
    onProgress?.({
      phase: "downloading",
      file: dump.file,
      receivedBytes,
      totalBytes: download.bytes,
      alreadyDownloaded: false,
    }),
  );

  const done = doneProgress(dump, bytes);
  onProgress?.(done);
  deps.logger.info(`downloaded ${dump.file} (${formatBytes(bytes)}), checksum verified`);
  return { ...done, file: dump.file, path: target };
}

function emptyProgress(): DumpDownloadProgress {
  return {
    phase: "finding",
    file: null,
    receivedBytes: 0,
    totalBytes: null,
    alreadyDownloaded: false,
  };
}

function doneProgress(dump: DataDump, bytes: number): DumpDownloadProgress {
  return {
    phase: "done",
    file: dump.file,
    receivedBytes: bytes,
    totalBytes: bytes,
    alreadyDownloaded: false,
  };
}

async function ensureRoom(options: DumpDownloadOptions, bytes: number | null): Promise<void> {
  fs.mkdirSync(options.dumpsDir, { recursive: true });
  if (bytes === null) return;
  const free = await (options.freeBytes ?? freeBytesIn)(options.dumpsDir);
  if (free >= bytes + SPARE_BYTES) return;
  throw new DataDumpError(
    `The dump needs ${formatBytes(bytes + SPARE_BYTES)} free in ${options.dumpsDir}, counting 1 GB to spare; it has ${formatBytes(free)}`,
  );
}

async function freeBytesIn(dir: string): Promise<number> {
  const stats = await fs.promises.statfs(dir);
  return stats.bavail * stats.bsize;
}

/**
 * Writes the body to `<target>.part` while hashing it, then renames it to the target if the
 * hash matches. Returns the size. A failed, cancelled or mismatched download leaves no file.
 */
async function saveVerified(
  download: { body: AsyncIterable<Uint8Array> },
  expected: { target: string; checksum: string; dump: DataDump },
  onBytes: (receivedBytes: number) => void,
): Promise<number> {
  const part = `${expected.target}.part`;
  const hash = createHash("sha256");
  let received = 0;
  let reportedAt = 0;
  const file = await fs.promises.open(part, "w");
  try {
    for await (const chunk of download.body) {
      hash.update(chunk);
      await file.write(chunk);
      received += chunk.length;
      if (Date.now() - reportedAt < PROGRESS_EVERY_MS) continue;
      reportedAt = Date.now();
      onBytes(received);
    }
    await file.close();
  } catch (error) {
    await file.close().catch(() => {});
    fs.rmSync(part, { force: true });
    throw error;
  }

  if (hash.digest("hex") !== expected.checksum) {
    fs.rmSync(part, { force: true });
    throw new DataDumpError(`${expected.dump.file} does not match its published checksum`);
  }
  fs.renameSync(part, expected.target);
  return received;
}
