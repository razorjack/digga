import { formatCount } from "./display.ts";
import type { Job, JobType } from "./types.ts";

export function jobProgress(job: Job): { text: string; fraction: number | null } {
  if (job.progress === null) return { text: "Waiting for progress", fraction: null };
  switch (job.type) {
    case "dump_load":
      return {
        text: `scanned ${formatCount(job.progress.scanned)}, matched ${formatCount(job.progress.matched)}`,
        fraction: null,
      };
    case "enrich": {
      const { done, total, failed } = job.progress;
      const failures = failed > 0 ? `, ${formatCount(failed)} failed` : "";
      return {
        text: `${formatCount(done)} of ${formatCount(total)}${failures}`,
        fraction: total > 0 ? done / total : null,
      };
    }
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

export const JOB_LABEL: Record<JobType, string> = {
  dump_load: "Load dump",
  import_collection: "Import collection",
  import_wantlist: "Import wantlist",
  import_history: "Import browser history",
  import_list: "Import Maybe list",
  enrich: "Enrich",
};

export function elapsed(job: Job): string {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
