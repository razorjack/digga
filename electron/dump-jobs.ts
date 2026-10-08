import { formatBytes, formatCounted } from "../src/shared/display.ts";
import {
  DOWNLOAD_RETRIED_ERROR,
  type DumpDownloadProgress,
  type DumpLoadProgress,
  type Job,
} from "../src/shared/types.ts";

/**
 * What the downloads and loads the server reports mean for the app: whether one runs, for the
 * quit question, the Dock's progress bar, keeping the Mac awake and the notification when a load
 * ends. Pure, so vitest covers it.
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

/** setProgressBar() removes the bar below 0 and shows an indeterminate one above 1. */
export const NO_PROGRESS = -1;
export const UNKNOWN_PROGRESS = 2;

/**
 * The Dock's progress bar: how far the load has read while one runs, which the setup waits for,
 * else how much of the download has arrived; none while neither runs.
 */
export function progressBarValue(jobs: DumpJob[]): number {
  const parts = jobs.map(runningPart);
  const load = parts.find((part) => part.kind === "load");
  if (load) return readFraction(load.progress) ?? UNKNOWN_PROGRESS;
  const download = parts.find((part) => part.kind === "download");
  if (download) return receivedFraction(download.progress) ?? UNKNOWN_PROGRESS;
  return NO_PROGRESS;
}

/** What the notification says when a load ends while no window of the app is focused. */
export interface Notice {
  title: string;
  body: string;
}

/**
 * A load or update that finished or failed; null for any other job change, and for a load that
 * stopped because its download runs once more after a checksum mismatch, which the setup starts
 * again by itself. A cancelled load was the user's doing.
 */
export function loadEndNotice(job: Job): Notice | null {
  if (job.type !== "dump_load" && job.type !== "dump_update") return null;
  if (job.status === "failed" && job.error !== DOWNLOAD_RETRIED_ERROR)
    return { title: "The catalogue stopped loading", body: job.error ?? "No reason was given." };
  if (job.status !== "done") return null;
  const progress = job.progress && "matched" in job.progress ? job.progress : null;
  const kept = (progress?.matched ?? 0) + (progress?.coverage ?? 0);
  return { title: "The catalogue is in", body: `${formatCounted(kept, "release")} kept.` };
}

function receivedFraction(progress: DumpDownloadProgress | null): number | null {
  if (!progress?.totalBytes) return null;
  return Math.min(1, progress.receivedBytes / progress.totalBytes);
}

/** How much of the dump the load has read; null before it knows the dump's size. */
function readFraction(progress: DumpLoadProgress | null): number | null {
  if (progress?.bytesRead == null || !progress.totalBytes) return null;
  return Math.min(1, progress.bytesRead / progress.totalBytes);
}
