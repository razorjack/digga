import { formatBytes, formatCount, formatEta } from "./display.ts";
import type {
  DumpDownloadProgress,
  DumpLoadProgress,
  Job,
  JobType,
  SellerImportProgress,
} from "./types.ts";

interface ProgressSummary {
  text: string;
  fraction: number | null;
}

/** An estimate needs some progress to go on; earlier ones swing too much to help. */
const ESTIMATE_AFTER = { fraction: 0.01, seconds: 10 };

/** What the job has done, as a line and a fraction, and for a running job the time it has left. */
export function jobProgress(job: Job, now: number = Date.now()): ProgressSummary {
  const summary = progressOf(job);
  const left = job.status === "running" ? timeLeft(job, summary.fraction, now) : null;
  return left ? { ...summary, text: `${summary.text}, ${left}` } : summary;
}

/** "~12 min left", from the pace so far. */
function timeLeft(job: Job, fraction: number | null, now: number): string | null {
  if (fraction === null || fraction < ESTIMATE_AFTER.fraction || fraction >= 1) return null;
  const seconds = stepSeconds(job, now);
  if (seconds === null || seconds < ESTIMATE_AFTER.seconds) return null;
  const hoursLeft = (seconds * (1 - fraction)) / fraction / 3600;
  // Non-breaking spaces keep the estimate on one line when the progress wraps.
  return `${formatEta(hoursLeft)} left`.replaceAll(" ", "\u00a0");
}

/**
 * Seconds the running step has taken, which the fraction belongs to. An update's load step times
 * itself; every other step starts with its job.
 */
function stepSeconds(job: Job, now: number): number | null {
  if (job.type === "dump_update" && job.progress?.step === "load")
    return job.progress.elapsedSeconds;
  if (!job.startedAt) return null;
  return (now - Date.parse(job.startedAt)) / 1000;
}

function progressOf(job: Job): ProgressSummary {
  if (job.progress === null) return { text: "Waiting for progress", fraction: null };
  switch (job.type) {
    case "dump_download":
      return downloadProgress(job.progress);
    case "dump_load":
      return loadProgress(job.progress);
    case "dump_update":
      return job.progress.step === "download"
        ? downloadProgress(job.progress)
        : loadProgress(job.progress);
    case "import_seller":
      return sellerProgress(job.progress);
    case "import_history":
      return {
        text: `${formatCount(job.progress.discogsUrls)} Discogs links, ${formatCount(job.progress.keys)} releases`,
        fraction: null,
      };
    default: {
      const { page, pages, processed } = job.progress;
      const total = pages ? ` of ${pages}` : "";
      return {
        text: `page ${page}${total}, ${formatCount(processed)} items`,
        fraction: pages ? page / pages : null,
      };
    }
  }
}

/**
 * Releases scanned and kept, and once the load is recorded, what it added and did not find. The
 * share of the file read so far is the fraction.
 */
function loadProgress(progress: DumpLoadProgress): ProgressSummary {
  const { scanned, matched, coverage, added, missing, bytesRead, totalBytes } = progress;
  const parts = [`scanned ${formatCount(scanned)}`, `matched ${formatCount(matched)}`];
  if (coverage > 0) parts.push(`${formatCount(coverage)} more for their label or artist`);
  if (added !== null) parts.push(`${formatCount(added)} new`);
  if (missing) parts.push(`${formatCount(missing)} not found`);
  return {
    text: parts.join(", "),
    fraction: bytesRead !== null && totalBytes ? bytesRead / totalBytes : null,
  };
}

/** The dump, by its date, and how much of it has arrived. */
function downloadProgress(progress: DumpDownloadProgress): ProgressSummary {
  const { phase, file, receivedBytes, totalBytes, alreadyDownloaded } = progress;
  if (file === null) return { text: "looking for the newest dump", fraction: null };
  const dump = `${/(\d{4})(\d{2})(\d{2})/.exec(file)?.slice(1).join("-") ?? file} dump`;
  if (alreadyDownloaded) return { text: `${dump}, downloaded before`, fraction: 1 };
  if (phase === "done") return { text: `${dump}, ${formatBytes(receivedBytes)}`, fraction: 1 };
  const total = totalBytes === null ? "" : ` of ${formatBytes(totalBytes)}`;
  return {
    text: `${dump}: ${formatBytes(receivedBytes)}${total}`,
    fraction: totalBytes ? receivedBytes / totalBytes : null,
  };
}

/** Pages while the shop is read, then how much of it was read and how much of it is loaded. */
function sellerProgress(progress: SellerImportProgress): ProgressSummary {
  const { username, page, pages, listings, read, records } = progress;
  if (records === null) {
    const total = pages ? ` of ${pages}` : "";
    return {
      text: `${username}: page ${page}${total}, ${formatCount(read)} listings`,
      fraction: pages ? page / pages : null,
    };
  }
  const cut = listings !== null && read < listings ? ` of ${formatCount(listings)}` : "";
  return {
    text: `${username}: ${formatCount(read)}${cut} listings, ${formatCount(records)} loaded records${shopChanges(progress)}`,
    fraction: 1,
  };
}

/** "; 3 releases gone, 5 new since the last read" once a shop has been read before. */
function shopChanges(progress: SellerImportProgress): string {
  const { gone, added } = progress;
  if (gone === null || added === null) return "";
  return `; ${formatCount(gone)} releases gone, ${formatCount(added)} new since the last read`;
}

export const JOB_LABEL: Record<JobType, string> = {
  dump_download: "Download dump",
  dump_load: "Load dump",
  dump_update: "Update from the newest dump",
  import_collection: "Import collection",
  import_wantlist: "Import wantlist",
  import_history: "Import browser history",
  import_list: "Import Maybe list",
  import_seller: "Read seller shop",
};

/** "45 s", "7 min 45 s", "2 h 5 min". */
export function elapsed(job: Job, now: number = Date.now()): string {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}
