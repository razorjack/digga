import type { GrowingFile, GrowingState } from "../../../tools/dump/growing.ts";
import type { Db } from "../db/db.ts";
import { getJob } from "../db/jobs.ts";

/**
 * The dump a download job is writing, as a load reads it. The load may run in a worker with its
 * own connection, so it asks the jobs table rather than the job itself.
 */
export function followDownload(db: Db, jobId: string): GrowingFile {
  const download = () => {
    const job = getJob(db, jobId);
    return job?.type === "dump_download" ? job : null;
  };
  return {
    state: () => downloadState(download()),
    totalBytes: () => download()?.progress?.totalBytes ?? null,
  };
}

function downloadState(job: ReturnType<typeof getJob>): GrowingState {
  if (!job) return { state: "failed", reason: "The download the load was reading is gone" };
  if (job.status === "done") return { state: "whole" };
  if (job.status === "running" || job.status === "queued") return { state: "writing" };
  if (job.status === "cancelled") return { state: "failed", reason: "The download was cancelled" };
  return { state: "failed", reason: `The download stopped: ${job.error ?? "no reason given"}` };
}
