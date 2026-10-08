import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type DumpJob, quitQuestion, runningDumpJobs } from "../electron/dump-jobs.ts";
import { openDb, type Db } from "../src/server/db/db.ts";
import type { Desktop } from "../src/server/desktop.ts";
import { createJobRunner } from "../src/server/jobs/runner.ts";
import { createLogger } from "../src/server/logger.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type {
  DumpDownloadProgress,
  DumpLoadProgress,
  DumpUpdateProgress,
  Job,
} from "../src/shared/types.ts";
import { silentLogger, testSecrets } from "./helpers.ts";

/** What the server reported to the desktop: each job change as type, status and progress. */
interface Report {
  type: Job["type"];
  status: Job["status"];
  progress: unknown;
  error: string | null;
}

describe("the server's reports to the desktop", () => {
  let tmp: string;
  let db: Db;
  let server: DiggaServer;
  let reports: Report[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-desktop-"));
    db = openDb(":memory:");
    reports = [];
    const desktop: Desktop = {
      jobChanged: ({ type, status, progress, error }) =>
        reports.push({ type, status, progress, error }),
    };
    server = createServer({
      config: DEFAULT_CONFIG,
      paths: resolvePaths({ dataDir: tmp }),
      secrets: testSecrets(),
      logger: silentLogger,
      db,
      serveStatic: false,
      persistConfig: false,
      desktop,
    });
  });

  afterEach(async () => {
    await server.stop();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("tells the desktop when a job starts, each time it reports progress, and when it ends", async () => {
    const progress = { page: 1, pages: 2, processed: 100, stubs: 0, added: 100, removed: 0 };

    await server.jobs.runAndWait("import_wantlist", async ({ onProgress }) => {
      onProgress(progress);
      return null;
    });

    expect(reports).toEqual([
      { type: "import_wantlist", status: "running", progress: null, error: null },
      { type: "import_wantlist", status: "running", progress, error: null },
      { type: "import_wantlist", status: "done", progress, error: null },
    ]);
  });

  it("tells it how a job failed, and that a stopping server cancelled one", async () => {
    const failed = server.jobs.runAndWait("import_collection", async () => {
      throw new Error("Discogs answered 503");
    });
    await expect(failed).rejects.toThrow("Discogs answered 503");
    server.jobs.run("dump_download", ({ signal }) => untilAborted(signal));

    await server.stop();

    expect(reports.filter((report) => report.status !== "running")).toEqual([
      {
        type: "import_collection",
        status: "failed",
        progress: null,
        error: "Discogs answered 503",
      },
      { type: "dump_download", status: "cancelled", progress: null, error: "Cancelled" },
    ]);
  });
});

describe("a job listener", () => {
  it("that throws leaves the job to finish, and the runner logs it", async () => {
    const db = openDb(":memory:");
    const warnings: string[] = [];
    const logger = createLogger({
      sink: { write: (level, _scope, message) => level === "warn" && warnings.push(message) },
    });
    try {
      const runner = createJobRunner(db, logger, () => {
        throw new Error("the window is gone");
      });

      const { job } = await runner.runAndWait("import_wantlist", async () => null);

      expect(job.status).toBe("done");
      expect(warnings).toEqual([
        `the listener of job ${job.id} failed`,
        `the listener of job ${job.id} failed`,
      ]);
    } finally {
      db.close();
    }
  });
});

describe("the downloads and loads the app follows", () => {
  it("are the dump jobs running now, in the order they started", () => {
    const running = runningDumpJobs();
    const download = downloadJob(null);
    const load = loadJob(null);

    running.update(download);
    running.update(importJob());
    running.update(load);
    expect(running.list()).toEqual([download, load]);

    running.update({ ...download, status: "done" });
    expect(running.list()).toEqual([load]);
    running.update({ ...load, status: "cancelled" });
    expect(running.list()).toEqual([]);
  });
});

describe("quitting", () => {
  const resume = "Discogs does not resume downloads, so the next one starts from the beginning.";
  const keep =
    "The releases it has kept stay, and the next load reads the catalogue from the start.";

  it("asks nothing while no download or load runs", () => {
    expect(quitQuestion([])).toBeNull();
  });

  it("says where a download stops, and that the next one starts from the beginning", () => {
    expect(quitQuestion([downloadJob(downloading(4.1 * 1024 ** 3, 10.5 * 1024 ** 3))])).toEqual({
      message: "Quit while Digga downloads the catalogue?",
      detail: `The download stops at 4.1 GB of 10.5 GB. ${resume}`,
    });
    expect(quitQuestion([downloadJob(null)])?.detail).toBe(`The download stops. ${resume}`);
  });

  it("says how far a load has read, and that what it kept stays", () => {
    expect(quitQuestion([loadJob(reading(272, 1000))])).toEqual({
      message: "Quit while Digga loads the catalogue?",
      detail: `The load stops at 27%. ${keep}`,
    });
    expect(quitQuestion([loadJob(reading(null, null))])?.detail).toBe(`The load stops. ${keep}`);
  });

  it("names both when the setup's load reads the download as it arrives", () => {
    const jobs = [downloadJob(downloading(2048, 4096)), loadJob(reading(250, 1000))];

    expect(quitQuestion(jobs)).toEqual({
      message: "Quit while Digga downloads and loads the catalogue?",
      detail: `The download stops at 2 KB of 4 KB. ${resume} The load stops at 25%. ${keep}`,
    });
  });

  it("asks about the part of a monthly update that runs", () => {
    const loadStep = updateJob({ step: "load", ...reading(500, 1000) });

    expect(quitQuestion([updateJob(null)])?.message).toBe(
      "Quit while Digga downloads the catalogue?",
    );
    expect(quitQuestion([loadStep])).toEqual({
      message: "Quit while Digga loads the catalogue?",
      detail: `The load stops at 50%. ${keep}`,
    });
  });
});

/** A job that runs until it is cancelled, as a download does when the server stops. */
function untilAborted(signal: AbortSignal): Promise<never> {
  const stopped = Promise.withResolvers<never>();
  signal.addEventListener("abort", () => stopped.reject(new Error("Cancelled")));
  return stopped.promise;
}

const RUNNING = {
  status: "running",
  error: null,
  createdAt: "2026-10-08T10:00:00.000Z",
  startedAt: "2026-10-08T10:00:00.000Z",
  finishedAt: null,
} as const;

function downloadJob(progress: DumpDownloadProgress | null): DumpJob {
  return { ...RUNNING, id: "download", type: "dump_download", progress };
}

function loadJob(progress: DumpLoadProgress | null): DumpJob {
  return { ...RUNNING, id: "load", type: "dump_load", progress };
}

function updateJob(progress: DumpUpdateProgress | null): DumpJob {
  return { ...RUNNING, id: "update", type: "dump_update", progress };
}

function importJob(): Job {
  return { ...RUNNING, id: "import", type: "import_wantlist", progress: null };
}

function downloading(receivedBytes: number, totalBytes: number | null): DumpDownloadProgress {
  return {
    phase: "downloading",
    file: "discogs_20260901_releases.xml.gz",
    receivedBytes,
    totalBytes,
    alreadyDownloaded: false,
    checksumMismatches: 0,
  };
}

function reading(bytesRead: number | null, totalBytes: number | null): DumpLoadProgress {
  return {
    phase: "scanning",
    scanned: 0,
    matched: 0,
    coverage: 0,
    upserted: 0,
    elapsedSeconds: 0,
    added: null,
    missing: null,
    bytesRead,
    totalBytes,
    latest: null,
    keptByYear: {},
  };
}
