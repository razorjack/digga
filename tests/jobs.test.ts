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
