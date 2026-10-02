import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import {
  createJob,
  getJob,
  markJobFinished,
  markJobStarted,
  updateJobProgress,
} from "../src/server/db/jobs.ts";
import {
  checksumFor,
  createDataDumpClient,
  parseDumpListing,
} from "../src/server/discogs/data-dumps.ts";
import { deleteDumpFile, listDumpFiles } from "../src/server/dump-files.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer } from "../src/server/server.ts";
import type { ApiError, DumpsResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { downloadDump } from "../src/server/jobs/dump-download.ts";
import { followDownload } from "../src/server/jobs/follow-download.ts";
import { jobProgress } from "../src/shared/job-display.ts";
import {
  DOWNLOAD_RETRIED_ERROR,
  type DumpDownloadProgress,
  type Job,
} from "../src/shared/types.ts";
import { FIXTURE_GZ, silentLogger, testSecrets } from "./helpers.ts";

const ROOT = `<pre>
  <a href="?prefix=data%2F2025%2F">2025/</a>
  <a href="?prefix=data%2F2026%2F">2026/</a>
</pre>`;
const YEAR_2026 = `<pre>
  <a href="?download=data%2F2026%2Fdiscogs_20260801_CHECKSUM.txt">discogs_20260801_CHECKSUM.txt</a>
  <a href="?download=data%2F2026%2Fdiscogs_20260801_releases.xml.gz">discogs_20260801_releases.xml.gz</a>
  <a href="?download=data%2F2026%2Fdiscogs_20260901_labels.xml.gz">discogs_20260901_labels.xml.gz</a>
2026-09-01 19:21:51             10.5 GB        <a href="?download=data%2F2026%2Fdiscogs_20260901_releases.xml.gz">discogs_20260901_releases.xml.gz</a>
</pre>`;

const BODY = Buffer.from("<releases>a whole dump</releases>");
const SUM = createHash("sha256").update(BODY).digest("hex");

interface FakeSite {
  pages: Record<string, string>;
  body: Buffer;
  checksum: string;
  requests: string[];
}

function fakeSite(): FakeSite {
  return {
    pages: { "data/": ROOT, "data/2026/": YEAR_2026, "data/2025/": "" },
    body: BODY,
    checksum: SUM,
    requests: [],
  };
}

function fetchFrom(site: FakeSite): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const prefix = url.searchParams.get("prefix");
    const download = url.searchParams.get("download");
    site.requests.push(prefix ?? download ?? url.search);
    if (prefix !== null && prefix in site.pages) return new Response(site.pages[prefix]);
    if (download === "data/2026/discogs_20260901_CHECKSUM.txt")
      return new Response(
        `abc discogs_20260901_labels.xml.gz\n${site.checksum} discogs_20260901_releases.xml.gz\n`,
      );
    if (download === "data/2026/discogs_20260901_releases.xml.gz")
      return new Response(site.body, { headers: { "content-length": String(site.body.length) } });
    return new Response("not found", { status: 404 });
  };
}

describe("the data.discogs.com listing", () => {
  it("finds the year pages and the releases dumps, newest first", () => {
    expect(parseDumpListing(ROOT)).toEqual({ years: [2026, 2025], dumps: [] });
    expect(parseDumpListing(YEAR_2026).dumps).toEqual([
      {
        date: "2026-09-01",
        file: "discogs_20260901_releases.xml.gz",
        bytes: Math.round(10.5 * 1024 ** 3),
      },
      { date: "2026-08-01", file: "discogs_20260801_releases.xml.gz", bytes: null },
    ]);
  });

  it("reads the checksum of one file from CHECKSUM.txt", () => {
    const text = `${"a".repeat(64)} discogs_20260901_labels.xml.gz\n${"B".repeat(64)}  discogs_20260901_releases.xml.gz\n`;
    expect(checksumFor(text, "discogs_20260901_releases.xml.gz")).toBe("b".repeat(64));
    expect(checksumFor(text, "discogs_20260901_masters.xml.gz")).toBeNull();
  });

  it("looks in last year's page while the new year has no dump yet", async () => {
    const site = fakeSite();
    site.pages["data/"] = `${ROOT}<a href="?prefix=data%2F2027%2F">2027/</a>`;
    site.pages["data/2027/"] = "<pre></pre>";
    const client = createDataDumpClient({ fetchImpl: fetchFrom(site) });
    expect(await client.newestReleasesDump()).toMatchObject({
      date: "2026-09-01",
      file: "discogs_20260901_releases.xml.gz",
    });
    expect(site.requests).toEqual(["data/", "data/2027/", "data/2026/"]);
  });
});

describe("downloading the newest dump", () => {
  let tmp: string;
  let dumpsDir: string;
  let site: FakeSite;
  let progress: DumpDownloadProgress[];
  const plenty = async () => 100 * 1024 ** 3;

  const download = (freeBytes = plenty, signal?: AbortSignal) =>
    downloadDump(
      { dumps: createDataDumpClient({ fetchImpl: fetchFrom(site) }), logger: silentLogger },
      { dumpsDir, freeBytes, signal },
      (update) => progress.push(update),
    );

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-download-"));
    dumpsDir = path.join(tmp, "dumps");
    site = fakeSite();
    progress = [];
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("saves the dump under its name once the checksum matches", async () => {
    const result = await download();
    const target = path.join(dumpsDir, "discogs_20260901_releases.xml.gz");
    expect(result).toMatchObject({ phase: "done", path: target, receivedBytes: BODY.length });
    expect(fs.readFileSync(target)).toEqual(BODY);
    expect(fs.readdirSync(dumpsDir)).toEqual(["discogs_20260901_releases.xml.gz"]);
    expect(progress[0]).toMatchObject({ phase: "finding", file: null });
    expect(progress.at(-1)).toMatchObject({ phase: "done", alreadyDownloaded: false });
    expect(listDumpFiles(dumpsDir)).toEqual([
      { name: "discogs_20260901_releases.xml.gz", date: "2026-09-01", bytes: BODY.length },
    ]);
  });

  it("does not download a dump that is there already", async () => {
    await download();
    site.requests = [];
    const again = await download();
    expect(again).toMatchObject({ alreadyDownloaded: true, receivedBytes: BODY.length });
    expect(site.requests).toEqual(["data/", "data/2026/"]);
  });

  it("downloads once more after a mismatch, and keeps nothing of two that do not match", async () => {
    site.checksum = "0".repeat(64);
    await expect(download()).rejects.toThrow("does not match its published checksum");
    expect(fs.readdirSync(dumpsDir)).toEqual([]);
    const downloads = site.requests.filter((request) => request.endsWith("releases.xml.gz"));
    expect(downloads).toHaveLength(2);
    expect(progress.at(-1)).toMatchObject({ phase: "downloading", checksumMismatches: 2 });
  });

  it("keeps the second download when the first does not match its checksum", async () => {
    let wrongChecksums = 1;
    const fetchImpl = fetchFrom(site);
    const flaky: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("CHECKSUM") || wrongChecksums === 0) return fetchImpl(input, init);
      wrongChecksums -= 1;
      site.checksum = "0".repeat(64);
      const response = await fetchImpl(input, init);
      site.checksum = SUM;
      return response;
    };
    const result = await downloadDump(
      { dumps: createDataDumpClient({ fetchImpl: flaky }), logger: silentLogger },
      { dumpsDir, freeBytes: plenty },
      (update) => progress.push(update),
    );

    expect(result).toMatchObject({ phase: "done", checksumMismatches: 1 });
    expect(fs.readdirSync(dumpsDir)).toEqual(["discogs_20260901_releases.xml.gz"]);
    // The mismatch is reported before the second download starts, for a load reading the first.
    const mismatch = progress.findIndex((update) => update.checksumMismatches === 1);
    expect(progress[mismatch]).toMatchObject({ phase: "downloading", receivedBytes: BODY.length });
    expect(progress.slice(mismatch).every((update) => update.checksumMismatches === 1)).toBe(true);
  });

  it("refuses to fill the disk", async () => {
    await expect(download(async () => 1024)).rejects.toThrow(
      /needs 1 GB free in .*, counting 1 GB to spare; it has 1 KB/,
    );
    expect(fs.readdirSync(dumpsDir)).toEqual([]);
  });

  it("reports how much had arrived when the transfer stops", async () => {
    const chunk = Buffer.alloc(1000, 1);
    site.body = Buffer.alloc(10_000);
    const fetchImpl = fetchFrom(site);
    const dropped: typeof fetch = async (input, init) => {
      const response = await fetchImpl(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("releases.xml.gz")) return response;
      // Two chunks, the second within the second that keeps reports apart, then a dropped connection.
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls <= 2) controller.enqueue(chunk);
          else controller.error(new TypeError("terminated"));
        },
      });
      return new Response(body, { headers: response.headers });
    };
    const stopped = downloadDump(
      { dumps: createDataDumpClient({ fetchImpl: dropped }), logger: silentLogger },
      { dumpsDir, freeBytes: plenty },
      (update) => progress.push(update),
    );

    await expect(stopped).rejects.toThrow("terminated");
    expect(progress.at(-1)).toMatchObject({
      phase: "downloading",
      receivedBytes: 2000,
      totalBytes: 10_000,
    });
    expect(fs.readdirSync(dumpsDir)).toEqual([]);
  });

  it("removes the partial file of a cancelled download", async () => {
    const controller = new AbortController();
    site.body = Buffer.alloc(4 * 1024 * 1024);
    const client = createDataDumpClient({ fetchImpl: fetchFrom(site) });
    const dumps = {
      ...client,
      async download(...args: Parameters<typeof client.download>) {
        const started = await client.download(...args);
        async function* abortAfterFirstChunk() {
          for await (const chunk of started.body) {
            yield chunk;
            controller.abort();
            throw new DOMException("The operation was aborted", "AbortError");
          }
        }
        return { ...started, body: abortAfterFirstChunk() };
      },
    };
    const cancelled = downloadDump(
      { dumps, logger: silentLogger },
      { dumpsDir, freeBytes: plenty, signal: controller.signal },
    );
    await expect(cancelled).rejects.toThrow("aborted");
    expect(fs.readdirSync(dumpsDir)).toEqual([]);
  });
});

describe("a load following the download", () => {
  it("stops once the download throws its file away for another try, also when that try has finished", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_download");
      markJobStarted(db, job.id);
      const progress: DumpDownloadProgress = {
        phase: "downloading",
        file: "discogs_20260901_releases.xml.gz",
        receivedBytes: 10,
        totalBytes: 100,
        alreadyDownloaded: false,
        checksumMismatches: 0,
      };
      updateJobProgress(db, job.id, progress);
      const growing = followDownload(db, job.id);
      expect(growing.state()).toEqual({ state: "writing" });

      updateJobProgress(db, job.id, { ...progress, receivedBytes: 0, checksumMismatches: 1 });
      expect(growing.state()).toEqual({ state: "failed", reason: DOWNLOAD_RETRIED_ERROR });
      markJobFinished(db, job.id, "done");
      expect(growing.state()).toEqual({ state: "failed", reason: DOWNLOAD_RETRIED_ERROR });
      // A load that started on the second download reads it to its end.
      expect(followDownload(db, job.id).state()).toEqual({ state: "whole" });
    } finally {
      db.close();
    }
  });
});

describe("the download in the jobs panel", () => {
  it("shows the file and how much of it has arrived", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_download");
      const base = { file: null, receivedBytes: 0, totalBytes: null, alreadyDownloaded: false };
      updateJobProgress(db, job.id, { ...base, phase: "finding" });
      expect(jobProgress(getJob(db, job.id)!)).toEqual({
        text: "looking for the newest dump",
        fraction: null,
      });
      const file = "discogs_20260901_releases.xml.gz";
      const total = 10 * 1024 ** 3;
      updateJobProgress(db, job.id, {
        ...base,
        phase: "downloading",
        file,
        receivedBytes: total / 4,
        totalBytes: total,
      });
      expect(jobProgress(getJob(db, job.id)!)).toEqual({
        text: "2026-09-01 dump: 2.5 GB of 10 GB",
        fraction: 0.25,
      });
      updateJobProgress(db, job.id, { ...base, phase: "done", file, alreadyDownloaded: true });
      expect(jobProgress(getJob(db, job.id)!).text).toBe("2026-09-01 dump, downloaded before");
    } finally {
      db.close();
    }
  });
});

describe("the download over HTTP", () => {
  it("runs one download at a time and lists the dump it saved", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-download-http-"));
    const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
    paths.dbFile = ":memory:";
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      persistConfig: false,
      fetchImpl: fetchFrom(fakeSite()),
    });
    try {
      const empty = await server.app.request("/api/dumps");
      expect(((await empty.json()) as DumpsResponse).files).toEqual([]);

      const started = await server.app.request("/api/jobs/dump-download", { method: "POST" });
      expect(started.status).toBe(202);
      const job = (await started.json()) as Job;
      const second = await server.app.request("/api/jobs/dump-download", { method: "POST" });
      expect([second.status, ((await second.json()) as ApiError).error]).toEqual([
        400,
        'Wait until "Download dump" has finished',
      ]);

      await expect.poll(() => server.jobs.get(job.id)?.status).toBe("done");
      const listed = (await (await server.app.request("/api/dumps")).json()) as DumpsResponse;
      expect(listed).toEqual({
        directory: paths.dumpsDir,
        files: [
          { name: "discogs_20260901_releases.xml.gz", date: "2026-09-01", bytes: BODY.length },
        ],
      });
    } finally {
      await server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("deleting dumps", () => {
  it("deletes only a dump the folder lists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-dumps-"));
    const dump = "discogs_20260801_releases.xml.gz";
    fs.writeFileSync(path.join(dir, dump), "old");
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep");
    try {
      expect(deleteDumpFile(dir, "notes.txt")).toBe(false);
      expect(deleteDumpFile(dir, `../${path.basename(dir)}/${dump}`)).toBe(false);
      expect(deleteDumpFile(dir, dump)).toBe(true);
      expect(fs.readdirSync(dir)).toEqual(["notes.txt"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deletes over HTTP, but not while a dump job runs", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-delete-http-"));
    const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
    paths.dbFile = ":memory:";
    fs.mkdirSync(paths.dumpsDir, { recursive: true });
    const old = "discogs_20260801_releases.xml.gz";
    fs.writeFileSync(path.join(paths.dumpsDir, old), "old");
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      persistConfig: false,
      fetchImpl: fetchFrom(fakeSite()),
    });
    const remove = (name: string) =>
      server.app.request(`/api/dumps/${encodeURIComponent(name)}`, { method: "DELETE" });
    try {
      const started = await server.app.request("/api/jobs/dump-download", { method: "POST" });
      const job = (await started.json()) as Job;
      const refused = await remove(old);
      expect([refused.status, ((await refused.json()) as ApiError).error]).toEqual([
        400,
        'Wait until "Download dump" has finished',
      ]);
      await expect.poll(() => server.jobs.get(job.id)?.status).toBe("done");

      expect((await remove("digga.sqlite")).status).toBe(404);
      const deleted = await remove(old);
      expect(((await deleted.json()) as DumpsResponse).files.map((file) => file.name)).toEqual([
        "discogs_20260901_releases.xml.gz",
      ]);
      expect(fs.existsSync(path.join(paths.dumpsDir, old))).toBe(false);
    } finally {
      await server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the monthly update over HTTP", () => {
  it("downloads the newest dump, then loads it, one dump job at a time", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-update-http-"));
    const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
    paths.dbFile = ":memory:";
    const site = fakeSite();
    site.body = fs.readFileSync(FIXTURE_GZ);
    site.checksum = createHash("sha256").update(site.body).digest("hex");
    const server = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
      persistConfig: false,
      fetchImpl: fetchFrom(site),
    });
    const post = (url: string, body?: unknown) =>
      server.app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      const started = await post("/api/jobs/dump-update");
      expect(started.status).toBe(202);
      const job = (await started.json()) as Job;
      const load = await post("/api/jobs/dump-load", { file: FIXTURE_GZ });
      expect([load.status, ((await load.json()) as ApiError).error]).toEqual([
        400,
        'Wait until "Update from the newest dump" has finished',
      ]);

      await expect.poll(() => server.jobs.get(job.id)?.status).toBe("done");
      expect(server.jobs.get(job.id)?.progress).toMatchObject({
        step: "load",
        phase: "done",
        matched: 5,
        added: 5,
      });
      expect(fs.existsSync(path.join(paths.dumpsDir, "discogs_20260901_releases.xml.gz"))).toBe(
        true,
      );
      expect(server.db.prepare("SELECT COUNT(*) FROM releases").pluck().get()).toBe(5);
    } finally {
      await server.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("estimates the load step from its own time, not the download's", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_update");
      markJobStarted(db, job.id);
      updateJobProgress(db, job.id, {
        step: "load",
        phase: "scanning",
        scanned: 4_000_000,
        matched: 15_000,
        coverage: 0,
        upserted: 15_000,
        elapsedSeconds: 240,
        bytesRead: 25,
        totalBytes: 100,
        added: null,
        missing: null,
      });
      const running = getJob(db, job.id)!;
      // The download took ten minutes before the load started.
      const now = Date.parse(running.startedAt!) + 840_000;
      expect(jobProgress(running, now).text).toBe(
        "scanned 4,000,000, matched 15,000, ~12\u00a0min\u00a0left",
      );
    } finally {
      db.close();
    }
  });
});
