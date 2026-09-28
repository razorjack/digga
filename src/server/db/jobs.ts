import { JobSchema } from "../../shared/jobs.ts";
import { randomUUID } from "node:crypto";
import type { Job, JobStatus, JobType } from "../../shared/types.ts";
import { type Db, nowIso } from "./db.ts";

interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  progress_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function rowToJob(r: JobRow): Job {
  return JobSchema.parse({
    id: r.id,
    type: r.type,
    status: r.status,
    progress: r.progress_json ? (JSON.parse(r.progress_json) as unknown) : null,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  });
}

export function createJob(db: Db, type: JobType): Job {
  const id = randomUUID();
  db.prepare("INSERT INTO jobs (id, type, status, created_at) VALUES (?, ?, 'queued', ?)").run(
    id,
    type,
    nowIso(),
  );
  return getJob(db, id)!;
}

export function markJobStarted(db: Db, id: string): void {
  db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(nowIso(), id);
}

export function updateJobProgress(db: Db, id: string, progress: unknown): void {
  db.prepare("UPDATE jobs SET progress_json = ? WHERE id = ?").run(JSON.stringify(progress), id);
}

export function markJobFinished(
  db: Db,
  id: string,
  status: "done" | "failed" | "cancelled",
  error?: string,
): void {
  db.prepare("UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(
    status,
    error ?? null,
    nowIso(),
    id,
  );
}

export function getJob(db: Db, id: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobs(db: Db, limit = 50): Job[] {
  const rows = db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as JobRow[];
  return rows.map(rowToJob);
}

/** Jobs left 'running' by a crashed process are marked failed on startup. */
export function failStaleJobs(db: Db): number {
  const info = db
    .prepare(
      "UPDATE jobs SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status IN ('queued', 'running')",
    )
    .run(nowIso());
  return info.changes;
}
