import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** The process holding a library, as its lock file names it. */
const LockOwnerSchema = z.object({
  pid: z.number().int().positive(),
  /** What it runs, for the message another process shows: "the Digga server", "digga restore". */
  holder: z.string(),
  since: z.string(),
});
type LockOwner = z.infer<typeof LockOwnerSchema>;

export interface LibraryLock {
  release(): void;
}

export class LibraryInUseError extends Error {}

/** The current time and how long this computer has run, which tell a lock left before a reboot. */
export interface LockClock {
  nowMs(): number;
  uptimeSeconds(): number;
}

const systemClock: LockClock = { nowMs: () => Date.now(), uptimeSeconds: () => os.uptime() };

/** The boot time derived from the uptime moves by a second or so between reads. */
const BOOT_TOLERANCE_MS = 60_000;

/**
 * Takes the library for this process, so one process at a time migrates it, recovers its
 * interrupted jobs, writes its scheduled backups and changes its data. A lock left by a process
 * that has ended is taken over. Read-only commands do not take it.
 */
export function lockLibrary(
  file: string,
  holder: string,
  clock: LockClock = systemClock,
): LibraryLock {
  const owner: LockOwner = {
    pid: process.pid,
    holder,
    since: new Date(clock.nowMs()).toISOString(),
  };
  if (!createLockFile(file, owner)) {
    removeStaleLock(file, clock);
    if (!createLockFile(file, owner))
      throw new LibraryInUseError("Another Digga process took the library just now.");
  }
  return { release: () => removeOwnLock(file) };
}

function createLockFile(file: string, owner: LockOwner): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify(owner), { flag: "wx" });
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * Throws when the process named in the lock still runs; removes the lock otherwise. A lock from
 * before the computer last started is stale whatever its process id: after a crash and a
 * reboot, another process can have that id.
 */
function removeStaleLock(file: string, clock: LockClock): void {
  const owner = readOwner(file);
  if (owner !== null && !predatesBoot(owner, clock) && isRunning(owner.pid))
    throw new LibraryInUseError(
      `The library is in use by ${owner.holder} (process ${owner.pid}, since ${owner.since}). ` +
        `Stop it first. If no Digga is running, delete the lock file ${file}.`,
    );
  fs.rmSync(file, { force: true });
}

function predatesBoot(owner: LockOwner, clock: LockClock): boolean {
  const bootedAtMs = clock.nowMs() - clock.uptimeSeconds() * 1000;
  return Date.parse(owner.since) < bootedAtMs - BOOT_TOLERANCE_MS;
}

/** Leaves a lock that another process took over after this one was thought gone. */
function removeOwnLock(file: string): void {
  if (readOwner(file)?.pid === process.pid) fs.rmSync(file, { force: true });
}

/** Null for a lock file that is gone or that a crash left unwritten. */
function readOwner(file: string): LockOwner | null {
  try {
    return LockOwnerSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Signal 0 only checks; EPERM means the process exists under another user. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}
