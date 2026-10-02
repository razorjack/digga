import type { GrowingFile, GrowingState } from "../../../tools/dump/growing.ts";
import type { Db } from "../db/db.ts";
import { getJob } from "../db/jobs.ts";
import { DOWNLOAD_RETRIED_ERROR, type Job } from "../../shared/types.ts";

/**
 * The dump a download job is writing, as a load reads it. The load may run in a worker with its
 * own connection, so it asks the jobs table rather than the job itself. A download that did not
 * match Discogs' checksum throws its file away and downloads once more, so the file this load
 * opened is gone for good once the job counts another mismatch.
 */
export function followDownload(db: Db, jobId: string): GrowingFile {
  const download = () => {
    const job = getJob(db, jobId);
    return job?.type === "dump_download" ? job : null;
  };
  const mismatchesAtStart = download()?.progress?.checksumMismatches ?? 0;
  return {
    state: () => downloadState(download(), mismatchesAtStart),
    totalBytes: () => download()?.progress?.totalBytes ?? null,
  };
}

function downloadState(
  job: Extract<Job, { type: "dump_download" }> | null,
  mismatchesAtStart: number,
): GrowingState {
  if (!job) return { state: "failed", reason: "The download the load was reading is gone" };
  // Before "done": a second download that has finished is not the file this load read.
  const retried = (job.progress?.checksumMismatches ?? 0) > mismatchesAtStart;
  if (retried && job.status !== "failed")
    return { state: "failed", reason: DOWNLOAD_RETRIED_ERROR };
  if (job.status === "done") return { state: "whole" };
  if (job.status === "cancelled") return { state: "failed", reason: "The download was cancelled" };
  if (job.status === "failed")
    return { state: "failed", reason: `The download stopped: ${job.error ?? "no reason given"}` };
  return { state: "writing" };
}
