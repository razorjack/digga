import { describe, expect, it } from "vite-plus/test";
import { openDb } from "../src/server/db/db.ts";
import { createJob, getJob, updateJobProgress } from "../src/server/db/jobs.ts";
import { createJobRunner } from "../src/server/jobs/runner.ts";
import { jobProgress } from "../src/shared/job-display.ts";
import { silentLogger } from "./helpers.ts";

describe("job contracts", () => {
  it("retains job result types and decodes persisted progress", async () => {
    const db = openDb(":memory:");
    try {
      const runner = createJobRunner(db, silentLogger);
      const { job, result } = await runner.runAndWait("enrich", async ({ onProgress }) => {
        onProgress({ done: 2, total: 3, failed: 1, currentReleaseId: null });
        return { completed: 2 };
      });
      expect(result.completed).toBe(2);
      expect(job.status).toBe("done");
      expect(jobProgress(job)).toEqual({ text: "2 of 3, 1 failed", fraction: 2 / 3 });
    } finally {
      db.close();
    }
  });

  it("accepts legacy dump results and rejects progress for another job kind", () => {
    const db = openDb(":memory:");
    try {
      const job = createJob(db, "dump_load");
      expect(jobProgress(job).fraction).toBeNull();
      updateJobProgress(db, job.id, { scanned: 5, matched: 2, upserted: 2, elapsedSeconds: 1 });
      expect(getJob(db, job.id)?.progress).toMatchObject({ phase: "done", matched: 2 });
      updateJobProgress(db, job.id, { done: 1, total: 1, failed: 0, currentReleaseId: null });
      expect(() => getJob(db, job.id)).toThrow();
    } finally {
      db.close();
    }
  });
});

it("waits for cancelled async work before releasing its database", async () => {
  const db = openDb(":memory:");
  const runner = createJobRunner(db, silentLogger);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = runner.run("enrich", async ({ signal, onProgress }) => {
    await pending;
    expect(signal.aborted).toBe(true);
    onProgress({ done: 0, total: 1, failed: 0, currentReleaseId: null });
  });
  let stopped = false;
  const stopping = runner.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(runner.active()).toEqual([job.id]);
  release();
  await stopping;
  expect(runner.get(job.id)?.status).toBe("cancelled");
  expect(runner.active()).toEqual([]);
  expect(() => runner.run("enrich", async () => {})).toThrow("stopping");
  db.close();
});

it("tracks a worker until exit even after its done message", async () => {
  const db = openDb(":memory:");
  const runner = createJobRunner(db, silentLogger);
  const script = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ type: 'done', result: null });
    setInterval(() => {}, 1000);
  `)}`,
  );
  const job = runner.runInWorker("dump_load", script, {});
  try {
    await expect.poll(() => runner.get(job.id)?.status).toBe("done");
    expect(runner.active()).toEqual([job.id]);
    await runner.stop();
    expect(runner.active()).toEqual([]);
    expect(runner.get(job.id)?.status).toBe("done");
  } finally {
    await runner.stop();
    db.close();
  }
});

it("reports an unexpected worker exit as failure", async () => {
  const db = openDb(":memory:");
  const runner = createJobRunner(db, silentLogger);
  const job = runner.runInWorker("dump_load", new URL("data:text/javascript,process.exit(2)"), {});
  try {
    await expect.poll(() => runner.get(job.id)?.status).toBe("failed");
    expect(runner.get(job.id)?.error).toBe("Worker exited with code 2");
  } finally {
    await runner.stop();
    db.close();
  }
});
