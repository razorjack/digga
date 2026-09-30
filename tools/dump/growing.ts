import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline, Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import zlib from "node:zlib";
import type { DumpInput } from "./load.ts";

/**
 * A dump another job is still writing: a download writes `<file>.part` and renames it to `<file>`
 * once its checksum matches. The load reads it as it grows, so it starts before the download ends.
 */
export interface GrowingFile {
  state(): GrowingState;
  /** The size the file will have, once the writer knows it. */
  totalBytes(): number | null;
}

export type GrowingState =
  | { state: "writing" }
  | { state: "whole" }
  | { state: "failed"; reason: string };

const CHUNK_BYTES = 1024 * 1024;
/** How long to wait at the end of the data written so far before reading again. */
const POLL_MS = 250;

/** The dump at `file`, read as its writer writes it; the stream fails when the writer does. */
export function openGrowingInput(file: string, growing: GrowingFile): DumpInput {
  const position = { bytes: 0 };
  const raw = Readable.from(readGrowingFile(file, growing, position), { objectMode: false });
  const input = { bytesRead: () => position.bytes, totalBytes: () => growing.totalBytes() };
  if (!file.endsWith(".gz")) return { stream: raw, ...input };
  const gunzip = zlib.createGunzip();
  pipeline(raw, gunzip, () => {});
  return { stream: gunzip, ...input };
}

/**
 * Yields the file's bytes, waiting at the end of what is written until the writer adds more,
 * and ends once the writer says the file is whole and every byte has been read. The handle stays
 * on the same file when the writer renames `.part` to its final name.
 */
async function* readGrowingFile(
  file: string,
  growing: GrowingFile,
  position: { bytes: number },
): AsyncGenerator<Buffer> {
  const handle = await openWhenWritten(file, growing);
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let whole = false;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position.bytes);
      if (bytesRead > 0) {
        position.bytes += bytesRead;
        yield Buffer.from(buffer.subarray(0, bytesRead));
        continue;
      }
      if (whole) return;
      whole = await waitForWriter(growing);
    }
  } finally {
    await handle.close();
  }
}

/** Opens the whole file, or the part being written; waits while the writer has created neither. */
async function openWhenWritten(file: string, growing: GrowingFile): Promise<FileHandle> {
  for (;;) {
    for (const candidate of [file, `${file}.part`]) {
      const handle = await openIfPresent(candidate);
      if (handle) return handle;
    }
    if (await waitForWriter(growing)) throw new Error(`${path.basename(file)} is not there`);
  }
}

/** True once the file is whole; throws when the writer failed; otherwise waits a moment. */
async function waitForWriter(growing: GrowingFile): Promise<boolean> {
  const state = growing.state();
  if (state.state === "failed") throw new Error(state.reason);
  if (state.state === "whole") return true;
  await sleep(POLL_MS);
  return false;
}

async function openIfPresent(file: string): Promise<FileHandle | null> {
  try {
    return await fs.promises.open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
