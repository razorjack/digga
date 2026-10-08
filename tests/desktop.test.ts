import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type DumpJob,
  loadEndNotice,
  NO_PROGRESS,
  progressBarValue,
  quitQuestion,
  runningDumpJobs,
  UNKNOWN_PROGRESS,
} from "../electron/dump-jobs.ts";
import { openDb, type Db } from "../src/server/db/db.ts";
import type { Desktop } from "../src/server/desktop.ts";
import { createDataDumpClient } from "../src/server/discogs/data-dumps.ts";
import { HistoryAccessError } from "../src/server/importers/history.ts";
import { createJobRunner } from "../src/server/jobs/runner.ts";
import { createLogger } from "../src/server/logger.ts";
import { type Paths, resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { readSetup } from "../src/server/setup.ts";
import type { ApiError, DumpFileResponse, DumpsFolderResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import {
  DOWNLOAD_RETRIED_ERROR,
  type DumpDownloadProgress,
  type DumpLoadProgress,
  type DumpUpdateProgress,
  type Job,
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
  let historyDenials: number;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-desktop-"));
    db = openDb(":memory:");
    reports = [];
    historyDenials = 0;
    const desktop: Desktop = {
      jobChanged: ({ type, status, progress, error }) =>
        reports.push({ type, status, progress, error }),
      chooseDumpFile: async () => null,
      chooseDumpsFolder: async () => null,
      historyAccessDenied: () => {
        historyDenials += 1;
      },
    };
    server = serverWith({ paths: resolvePaths({ dataDir: tmp }), db, desktop });
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
    runDownloadUntilStopped(server);

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
  it("tells it when a history import may not read a browser's history, and no other failure", async () => {
    const denied = server.jobs.runAndWait("import_history", async () => {
      throw new HistoryAccessError("/Users/dj/Library/Application Support/BraveSoftware", "EPERM");
    });
    await expect(denied).rejects.toThrow(HistoryAccessError);
    expect(historyDenials).toBe(1);
    const failed = server.jobs.runAndWait("import_history", async () => {
      throw new Error("No browser history found for brave");
    });
    await expect(failed).rejects.toThrow("No browser history found");

    expect(historyDenials).toBe(1);
    expect(reports.filter((report) => report.status === "failed")).toHaveLength(2);
  });
});

describe("the setup's dialogs", () => {
  let tmp: string;
  let db: Db;
  /** What the user picks in the next dialog; null cancels it. */
  let chosen: string | null;
  let asked: string[];
  const desktop: Desktop = {
    jobChanged: () => {},
    historyAccessDenied: () => {},
    chooseDumpFile: async () => {
      asked.push("dump file");
      return chosen;
    },
    chooseDumpsFolder: async (current) => {
      asked.push(`dumps folder from ${current}`);
      return chosen;
    },
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-desktop-"));
    db = openDb(":memory:");
    chosen = null;
    asked = [];
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function send(
    server: DiggaServer,
    method: "GET" | "POST",
    route: string,
  ): Promise<{ status: number; body: unknown }> {
    const response = await server.app.request(route, { method });
    return { status: response.status, body: await response.json() };
  }

  async function withServer(
    options: { desktop?: Desktop; paths?: Paths },
    use: (server: DiggaServer) => Promise<void>,
  ): Promise<void> {
    const server = serverWith({ paths: resolvePaths({ dataDir: tmp }), db, ...options });
    try {
      await use(server);
    } finally {
      await server.stop();
    }
  }

  it("are offered by the app's server, which answers the dump the user chose, anywhere", async () => {
    chosen = path.join(tmp, "elsewhere", "my releases.xml.gz");
    fs.mkdirSync(path.dirname(chosen));
    fs.writeFileSync(chosen, "");

    const setup = await readSetup({
      db,
      paths: resolvePaths({ dataDir: tmp }),
      dataDumps: createDataDumpClient({ fetchImpl: offline }),
      desktop,
    });
    expect(setup.desktop).toBe(true);
    await withServer({ desktop }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dump-file")).toEqual({
        status: 200,
        body: { file: chosen } satisfies DumpFileResponse,
      });
    });
  });

  it("answer no file when the user cancels", async () => {
    await withServer({ desktop }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dump-file")).toEqual({
        status: 200,
        body: { file: null },
      });
    });
  });

  it("refuse a file that is not a gzipped dump, or is gone", async () => {
    chosen = path.join(tmp, "discogs_20260901_releases.tar.gz");
    fs.writeFileSync(chosen, "");

    await withServer({ desktop }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dump-file")).toEqual({
        status: 400,
        body: {
          error:
            "discogs_20260901_releases.tar.gz is not a releases dump; pick a file ending in .xml.gz",
        } satisfies ApiError,
      });
      chosen = path.join(tmp, "discogs_20260901_releases.xml.gz");
      expect((await send(server, "POST", "/api/desktop/dump-file")).status).toBe(400);
    });
  });

  it("are not there in the CLI's server", async () => {
    await withServer({}, async (server) => {
      expect((await send(server, "POST", "/api/desktop/dump-file")).status).toBe(404);
      expect((await send(server, "POST", "/api/desktop/dumps-folder")).status).toBe(404);
    });
  });

  it("keep the dumps folder the user chose, for this server and every later start", async () => {
    chosen = path.join(tmp, "other disk");
    fs.mkdirSync(chosen);

    await withServer({ desktop }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dumps-folder")).toEqual({
        status: 200,
        body: { folder: chosen } satisfies DumpsFolderResponse,
      });
      expect(await send(server, "GET", "/api/dumps")).toEqual({
        status: 200,
        body: { directory: chosen, files: [] },
      });
    });

    expect(asked).toEqual([`dumps folder from ${path.join(tmp, "dumps")}`]);
    expect(resolvePaths({ dataDir: tmp })).toMatchObject({
      dumpsDir: chosen,
      dumpsDirSource: "chosen",
    });
  });

  it("keep the dumps folder when the user cancels or picks one Digga cannot write to", async () => {
    await withServer({ desktop }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dumps-folder")).toEqual({
        status: 200,
        body: { folder: null },
      });
      chosen = path.join(tmp, "gone");
      expect(await send(server, "POST", "/api/desktop/dumps-folder")).toEqual({
        status: 400,
        body: { error: `Digga cannot write to ${chosen}` },
      });
    });

    expect(resolvePaths({ dataDir: tmp }).dumpsDirSource).toBe("default");
  });

  it("ask for no dumps folder while a download runs, or when DIGGA_DUMPS_DIR names one", async () => {
    chosen = tmp;

    await withServer({ desktop }, async (server) => {
      runDownloadUntilStopped(server);
      expect(await send(server, "POST", "/api/desktop/dumps-folder")).toEqual({
        status: 400,
        body: { error: 'Wait until "Download dump" has finished' },
      });
    });
    const named = resolvePaths({ dataDir: tmp, dumpsDir: path.join(tmp, "named") });
    await withServer({ desktop, paths: named }, async (server) => {
      expect(await send(server, "POST", "/api/desktop/dumps-folder")).toEqual({
        status: 409,
        body: { error: "DIGGA_DUMPS_DIR names the dumps folder; change it there" },
      });
    });

    expect(asked).toEqual([]);
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

describe("the Dock's progress bar", () => {
  it("follows the load while one runs, else the download, and goes when neither runs", () => {
    const download = downloadJob(downloading(1024, 4096));

    expect(progressBarValue([])).toBe(NO_PROGRESS);
    expect(progressBarValue([download])).toBe(0.25);
    expect(progressBarValue([download, loadJob(reading(100, 1000))])).toBe(0.1);
    expect(progressBarValue([updateJob({ step: "load", ...reading(500, 1000) })])).toBe(0.5);
  });

  it("is indeterminate while the size is unknown", () => {
    expect(progressBarValue([downloadJob(null)])).toBe(UNKNOWN_PROGRESS);
    expect(progressBarValue([downloadJob(downloading(1024, null))])).toBe(UNKNOWN_PROGRESS);
    expect(progressBarValue([loadJob(reading(null, null))])).toBe(UNKNOWN_PROGRESS);
  });
});

describe("the notification when a load ends", () => {
  const done = { ...reading(1000, 1000), matched: 7139, coverage: 1200 };

  it("says what a finished load kept, and why a load failed", () => {
    expect(loadEndNotice({ ...loadJob(done), status: "done" })).toEqual({
      title: "The catalogue is in",
      body: "8,339 releases kept.",
    });
    expect(loadEndNotice({ ...updateJob({ step: "load", ...done }), status: "done" })?.title).toBe(
      "The catalogue is in",
    );
    const failed = {
      ...loadJob(null),
      status: "failed",
      error: "The download stopped: reset",
    } as const;
    expect(loadEndNotice(failed)).toEqual({
      title: "The catalogue stopped loading",
      body: "The download stopped: reset",
    });
  });

  it("says nothing of a running or cancelled load, a download, or a load the setup starts again", () => {
    expect(loadEndNotice(loadJob(done))).toBeNull();
    expect(loadEndNotice({ ...loadJob(done), status: "cancelled", error: "Cancelled" })).toBeNull();
    expect(loadEndNotice({ ...downloadJob(null), status: "failed", error: "reset" })).toBeNull();
    const retried = { ...loadJob(null), status: "failed", error: DOWNLOAD_RETRIED_ERROR } as const;
    expect(loadEndNotice(retried)).toBeNull();
  });
});

function serverWith(options: { paths: Paths; db: Db; desktop?: Desktop }): DiggaServer {
  return createServer({
    config: DEFAULT_CONFIG,
    secrets: testSecrets(),
    logger: silentLogger,
    serveStatic: false,
    persistConfig: false,
    ...options,
  });
}

/** data.discogs.com out of reach: the tests never ask the real one. */
async function offline(): Promise<Response> {
  throw new Error("offline");
}

/** A download that runs until the server stops and cancels it. */
function runDownloadUntilStopped(server: DiggaServer): void {
  server.jobs.run("dump_download", ({ signal }) => untilAborted(signal));
}

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
