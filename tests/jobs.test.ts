import { describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyMigrations, listMigrations, openDb } from "../src/server/db/db.ts";
import {
  createJob,
  getJob,
  listJobs,
  markJobStarted,
  updateJobProgress,
} from "../src/server/db/jobs.ts";
import { createJobRunner } from "../src/server/jobs/runner.ts";
import { createLogger } from "../src/server/logger.ts";
import { runWorker } from "../src/server/jobs/worker.ts";
import { elapsed, jobProgress } from "../src/shared/job-display.ts";
import { silentLogger } from "./helpers.ts";

describe("job contracts", () => {
  it("retains job result types and decodes persisted progress", async () => {
    const db = openDb(":memory:");
    try {
      const runner = createJobRunner(db, silentLogger);
      const { job, result } = await runner.runAndWait("import_wantlist", async ({ onProgress }) => {
        onProgress({ page: 2, pages: 3, processed: 150, stubs: 0, added: 150, removed: 0 });
        return { completed: 2 };
      });
      expect(result.completed).toBe(2);
      expect(job.status).toBe("done");
      expect(jobProgress(job)).toEqual({ text: "page 2 of 3, 150 items", fraction: 2 / 3 });
    } finally {
      db.close();
    }
  });

  it("tells how much of a seller's shop was read and how much of it is loaded", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "import_seller");
      const reading = { username: "Shop", page: 3, pages: 100, listings: 38112, read: 300 };
      updateJobProgress(db, job.id, { ...reading, records: null });
      expect(jobProgress(getJob(db, job.id)!)).toEqual({
        text: "Shop: page 3 of 100, 300 listings",
        fraction: 0.03,
      });
      updateJobProgress(db, job.id, { ...reading, page: 100, read: 10000, records: 212 });
      expect(jobProgress(getJob(db, job.id)!).text).toBe(
        "Shop: 10,000 of 38,112 listings, 212 loaded records",
      );
      updateJobProgress(db, job.id, { ...reading, listings: 300, records: 5 });
      expect(jobProgress(getJob(db, job.id)!).text).toBe("Shop: 300 listings, 5 loaded records");
      updateJobProgress(db, job.id, { ...reading, listings: 300, records: 5, gone: 3, added: 12 });
      expect(jobProgress(getJob(db, job.id)!).text).toBe(
        "Shop: 300 listings, 5 loaded records; 3 releases gone, 12 new since the last read",
      );
    } finally {
      db.close();
    }
  });

  it("shows how much of the dump file a load has read and the time it has left", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_load");
      markJobStarted(db, job.id);
      const counts = { phase: "scanning", scanned: 4_000_000, matched: 15_000, upserted: 15_000 };
      const gb = 1024 ** 3;
      updateJobProgress(db, job.id, {
        ...counts,
        elapsedSeconds: 240,
        bytesRead: 2.5 * gb,
        totalBytes: 10 * gb,
      });
      const running = getJob(db, job.id)!;
      const fourMinutesIn = Date.parse(running.startedAt!) + 240_000;
      expect(jobProgress(running, fourMinutesIn)).toEqual({
        text: "scanned 4,000,000, matched 15,000, ~12\u00a0min\u00a0left",
        fraction: 0.25,
      });
      expect(jobProgress(running, Date.parse(running.startedAt!) + 5_000).text).toBe(
        "scanned 4,000,000, matched 15,000",
      );
      updateJobProgress(db, job.id, {
        ...counts,
        elapsedSeconds: 240,
        bytesRead: null,
        totalBytes: null,
      });
      expect(jobProgress(getJob(db, job.id)!, fourMinutesIn)).toEqual({
        text: "scanned 4,000,000, matched 15,000",
        fraction: null,
      });
    } finally {
      db.close();
    }
  });

  it("tells how long a job has run in seconds, minutes or hours", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "import_wantlist");
      markJobStarted(db, job.id);
      const started = Date.parse(getJob(db, job.id)!.startedAt!);
      const running = getJob(db, job.id)!;
      expect(elapsed(running, started + 45_000)).toBe("45 s");
      expect(elapsed(running, started + 465_000)).toBe("7 min 45 s");
      expect(elapsed(running, started + 7_500_000)).toBe("2 h 5 min");
    } finally {
      db.close();
    }
  });

  it("drops the rows of the removed enrich jobs, which the panel could not describe", () => {
    const early = fs.mkdtempSync(path.join(os.tmpdir(), "digga-migrations-"));
    const db = openDb(":memory:", { foreign: true });
    try {
      for (const migration of listMigrations().filter((m) => m.version <= 4))
        fs.copyFileSync(migration.file, path.join(early, migration.name));
      applyMigrations(db, early);
      const insert = db.prepare(
        "INSERT INTO jobs (id, type, status, created_at) VALUES (?, ?, 'done', '2026-09-01')",
      );
      insert.run("a", "enrich");
      insert.run("b", "enrich_twelves");
      insert.run("c", "import_wantlist");
      applyMigrations(db);
      expect(listJobs(db).map((job) => job.id)).toEqual(["c"]);
    } finally {
      db.close();
      fs.rmSync(early, { recursive: true, force: true });
    }
  });

  it("accepts legacy dump results and rejects progress for another job kind", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_load");
      expect(jobProgress(job).fraction).toBeNull();
      updateJobProgress(db, job.id, { scanned: 5, matched: 2, upserted: 2, elapsedSeconds: 1 });
      expect(getJob(db, job.id)?.progress).toMatchObject({
        phase: "done",
        matched: 2,
        bytesRead: null,
      });
      updateJobProgress(db, job.id, {
        page: 1,
        pages: 1,
        processed: 1,
        stubs: 0,
        added: 1,
      });
      expect(() => getJob(db, job.id)).toThrow();
    } finally {
      db.close();
    }
  });
});

it("waits for cancelled async work before releasing its database", async () => {
  const db = openDb(":memory:");
  const logged: string[] = [];
  const logger = createLogger({
    sink: { write: (_level, _scope, message) => logged.push(message) },
  });
  const runner = createJobRunner(db, logger);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = runner.run("import_wantlist", async ({ signal, onProgress }) => {
    await pending;
    expect(signal.aborted).toBe(true);
    onProgress({ page: 1, pages: null, processed: 0, stubs: 0, added: 0, removed: 0 });
  });
  let stopped = false;
  const stopping = runner.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(runner.active()).toEqual([job.id]);
  // Said once the job is aborted, while the stop still waits for it.
  expect(logged).toContain("stopping: cancelled 1 running job(s), waiting for them");
  release();
  await stopping;
  expect(runner.get(job.id)?.status).toBe("cancelled");
  expect(runner.active()).toEqual([]);
  expect(() => runner.run("import_wantlist", async () => {})).toThrow("stopping");
  db.close();
});

it("finishes a worker step only once the worker has exited", async () => {
  const db = openDb(":memory:");
  const runner = createJobRunner(db, silentLogger);
  const script = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ type: 'progress', progress: { page: 1, pages: 2, processed: 100, stubs: 0, added: 100 } });
    parentPort.postMessage({ type: 'done', result: 7 });
    setTimeout(() => {}, 200);
  `)}`,
  );
  let result: number | null = null;
  const job = runner.run("import_wantlist", async (context) => {
    result = await runWorker<number>(script, {}, context);
  });
  try {
    await expect.poll(() => runner.get(job.id)?.progress).toMatchObject({ page: 1 });
    expect(runner.get(job.id)?.status).toBe("running");
    await expect.poll(() => runner.get(job.id)?.status).toBe("done");
    expect(result).toBe(7);
    expect(runner.active()).toEqual([]);
  } finally {
    await runner.stop();
    db.close();
  }
});

it("reports an unexpected worker exit as failure and a stopped worker as cancelled", async () => {
  const db = openDb(":memory:");
  const runner = createJobRunner(db, silentLogger);
  const crash = new URL("data:text/javascript,process.exit(2)");
  const hang = new URL("data:text/javascript,setInterval(() => {}, 1000)");
  const crashed = runner.run("dump_load", (context) => runWorker(crash, {}, context));
  const hanging = runner.run("dump_load", (context) => runWorker(hang, {}, context));
  try {
    await expect.poll(() => runner.get(crashed.id)?.status).toBe("failed");
    expect(runner.get(crashed.id)?.error).toBe("Worker exited with code 2");
    expect(runner.cancel(hanging.id)).toBe(true);
    await expect.poll(() => runner.get(hanging.id)?.status).toBe("cancelled");
    expect(runner.active()).toEqual([]);
  } finally {
    await runner.stop();
    db.close();
  }
});
