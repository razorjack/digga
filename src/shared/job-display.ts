import { formatCount } from "./display.ts";
import type { Job, JobType, SellerImportProgress } from "./types.ts";

export function jobProgress(job: Job): { text: string; fraction: number | null } {
  if (job.progress === null) return { text: "Waiting for progress", fraction: null };
  switch (job.type) {
    case "dump_load":
      return {
        text: `scanned ${formatCount(job.progress.scanned)}, matched ${formatCount(job.progress.matched)}`,
        fraction: null,
      };
    case "enrich":
    case "enrich_twelves": {
      const { done, total, failed } = job.progress;
      const failures = failed > 0 ? `, ${formatCount(failed)} failed` : "";
      return {
        text: `${formatCount(done)} of ${formatCount(total)}${failures}`,
        fraction: total > 0 ? done / total : null,
      };
    }
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

/** Pages while the shop is read, then how much of it was read and how much of it is loaded. */
function sellerProgress(progress: SellerImportProgress): { text: string; fraction: number | null } {
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
    text: `${username}: ${formatCount(read)}${cut} listings, ${formatCount(records)} loaded records`,
    fraction: 1,
  };
}

export const JOB_LABEL: Record<JobType, string> = {
  dump_load: "Load dump",
  import_collection: "Import collection",
  import_wantlist: "Import wantlist",
  import_history: "Import browser history",
  import_list: "Import Maybe list",
  import_seller: "Read seller shop",
  enrich: "Enrich",
  enrich_twelves: "Enrich Twelves",
};

export function elapsed(job: Job): string {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
