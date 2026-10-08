import { formatBytes } from "../src/shared/display.ts";
import type { DumpDownloadProgress, DumpLoadProgress, Job } from "../src/shared/types.ts";

/**
 * What the downloads and loads the server reports mean for the app: whether one runs, for the
 * quit question, the Dock's progress bar and keeping the Mac awake. Pure, so vitest covers it.
 */

/** A job that downloads the catalogue, loads it, or does both. */
export type DumpJob = Extract<Job, { type: "dump_download" | "dump_load" | "dump_update" }>;

export function isDumpJob(job: Job): job is DumpJob {
  return job.type === "dump_download" || job.type === "dump_load" || job.type === "dump_update";
}

function isRunning(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}

/** The downloads and loads running now, kept up to date from the server's job reports. */
export interface RunningDumpJobs {
  /** Takes in a reported job; other jobs are ignored. */
  update(job: Job): void;
  /** In the order they started. */
  list(): DumpJob[];
}

export function runningDumpJobs(): RunningDumpJobs {
  const running = new Map<string, DumpJob>();
  return {
    update(job) {
      if (!isDumpJob(job)) return;
      if (isRunning(job)) running.set(job.id, job);
      else running.delete(job.id);
    },
    list: () => [...running.values()],
  };
}

/** The question before quitting during a download or load: what quitting stops, and what is lost. */
export interface QuitQuestion {
  message: string;
  detail: string;
}

/** What one running job does now: a monthly update downloads first, then loads. */
type RunningPart =
  | { kind: "download"; progress: DumpDownloadProgress | null }
  | { kind: "load"; progress: DumpLoadProgress | null };

/** Null when nothing runs that quitting would stop; quitting then asks nothing. */
export function quitQuestion(jobs: DumpJob[]): QuitQuestion | null {
  const parts = jobs.map(runningPart);
  const download = parts.find((part) => part.kind === "download");
  const load = parts.find((part) => part.kind === "load");
  const activities: string[] = [];
  const lost: string[] = [];
  if (download) {
    activities.push("downloads");
    lost.push(downloadLoss(download.progress));
  }
  if (load) {
    activities.push("loads");
    lost.push(loadLoss(load.progress));
  }
  if (lost.length === 0) return null;
  return {
    message: `Quit while Digga ${activities.join(" and ")} the catalogue?`,
    detail: lost.join(" "),
  };
}

function runningPart(job: DumpJob): RunningPart {
  if (job.type === "dump_download") return { kind: "download", progress: job.progress };
  if (job.type === "dump_load") return { kind: "load", progress: job.progress };
  if (job.progress?.step === "load") return { kind: "load", progress: job.progress };
  return { kind: "download", progress: job.progress };
}

/** Discogs answers a range request with the whole file (docs/FIRST_RUN.md), so nothing is kept. */
function downloadLoss(progress: DumpDownloadProgress | null): string {
  const resume = "Discogs does not resume downloads, so the next one starts from the beginning.";
  const received = progress?.receivedBytes ?? 0;
  if (received === 0) return `The download stops. ${resume}`;
  const total = progress?.totalBytes ? ` of ${formatBytes(progress.totalBytes)}` : "";
  return `The download stops at ${formatBytes(received)}${total}. ${resume}`;
}

function loadLoss(progress: DumpLoadProgress | null): string {
  const keep =
    "The releases it has kept stay, and the next load reads the catalogue from the start.";
  const fraction = readFraction(progress);
  if (fraction === null) return `The load stops. ${keep}`;
  return `The load stops at ${Math.floor(fraction * 100)}%. ${keep}`;
}

/** How much of the dump the load has read; null before it knows the dump's size. */
function readFraction(progress: DumpLoadProgress | null): number | null {
  if (progress?.bytesRead == null || !progress.totalBytes) return null;
  return Math.min(1, progress.bytesRead / progress.totalBytes);
}
