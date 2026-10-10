import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createJob, getJob, markJobStarted } from "../src/server/db/jobs.ts";
import { openDb } from "../src/server/db/db.ts";
import { LibraryInUseError, lockLibrary } from "../src/server/library-lock.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { silentLogger, testSecrets } from "./helpers.ts";

let tmp: string;
let lockFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-lock-"));
  lockFile = path.join(tmp, "digga.lock");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A process id that no running process has: one of a process that has ended. */
function endedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid!;
}

describe("the library lock", () => {
  it("refuses a second holder while the first runs, naming the first", () => {
    const lock = lockLibrary(lockFile, "the Digga server");

    expect(() => lockLibrary(lockFile, "digga restore")).toThrow(LibraryInUseError);
    expect(() => lockLibrary(lockFile, "digga restore")).toThrow(
      `in use by the Digga server (process ${process.pid}`,
    );
    lock.release();
    lockLibrary(lockFile, "digga restore").release();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("takes over a lock whose process has ended, or that a crash left unwritten", () => {
    const stale = { pid: endedPid(), holder: "digga import wantlist", since: "2026-10-01" };
    fs.writeFileSync(lockFile, JSON.stringify(stale));
    lockLibrary(lockFile, "the Digga server").release();

    fs.writeFileSync(lockFile, "");
    lockLibrary(lockFile, "the Digga server").release();
  });

  it("takes over a lock from before the last boot, whose process id another process has now", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const clock = { nowMs: () => now, uptimeSeconds: () => 3600 };
    const beforeBoot = { pid: process.pid, holder: "the Digga app", since: "2026-10-10T10:00:00Z" };
    fs.writeFileSync(lockFile, JSON.stringify(beforeBoot));

    lockLibrary(lockFile, "the Digga server", clock).release();

    const afterBoot = { ...beforeBoot, since: "2026-10-10T11:30:00Z" };
    fs.writeFileSync(lockFile, JSON.stringify(afterBoot));
    expect(() => lockLibrary(lockFile, "the Digga server", clock)).toThrow(LibraryInUseError);
  });

  it("names the lock file, so a user can remove it by hand", () => {
    const lock = lockLibrary(lockFile, "the Digga server");

    expect(() => lockLibrary(lockFile, "digga restore")).toThrow(
      `If no Digga is running, delete the lock file ${lockFile}.`,
    );
    lock.release();
  });

  it("leaves a lock that another process has taken over since", () => {
    const lock = lockLibrary(lockFile, "the Digga server");
    const other = { pid: endedPid(), holder: "digga restore", since: "2026-10-03" };
    fs.writeFileSync(lockFile, JSON.stringify(other));

    lock.release();

    expect(JSON.parse(fs.readFileSync(lockFile, "utf8"))).toEqual(other);
  });

  it("keeps a second server off a library before it fails the first one's running jobs", async () => {
    const paths = resolvePaths({ dataDir: tmp });
    const options = {
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
    };
    const first = createServer(options);
    const job = createJob(first.db, "dump_load");
    markJobStarted(first.db, job.id);

    expect(() => createServer(options)).toThrow(LibraryInUseError);
    expect(getJob(first.db, job.id)?.status).toBe("running");
    await first.stop();

    const next = createServer(options);
    expect(getJob(next.db, job.id)?.status).toBe("failed");
    await next.stop();
    expect(fs.existsSync(paths.lockFile)).toBe(false);
  });

  it("names the holder the server was given, such as the Electron app", async () => {
    const paths = resolvePaths({ dataDir: tmp });
    const app = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      libraryHolder: "the Digga app",
    });

    expect(() => lockLibrary(paths.lockFile, "digga restore")).toThrow(
      `in use by the Digga app (process ${process.pid}`,
    );
    await app.stop();
  });

  it("lets go of the library when the server cannot open it", () => {
    const paths = resolvePaths({ dataDir: tmp });
    const newer = openDb(paths.dbFile);
    newer.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run();
    newer.close();

    expect(() =>
      createServer({
        config: DEFAULT_CONFIG,
        paths,
        secrets: testSecrets(),
        logger: silentLogger,
      }),
    ).toThrow("newer than this Digga knows");
    expect(fs.existsSync(paths.lockFile)).toBe(false);
  });
});
