import { formatCount } from "../shared/display.ts";
import type { Job } from "../shared/types.ts";
import { api } from "./api.ts";
import { stats } from "./stores.svelte.ts";

const DUMP_JOBS = new Set<Job["type"]>(["dump_download", "dump_load", "dump_update"]);
const POLL_MS = 1000;

type DumpJob = Extract<Job, { type: "dump_download" | "dump_load" | "dump_update" }>;

/**
 * The dump job running now, for the header's indicator, Triage and the setup. It asks the server
 * once when the app opens and again whenever something starts a dump job, then every second
 * while one runs.
 */
class LoadStatusStore {
  /** The running load, or else the running download; null when neither runs. */
  job = $state.raw<DumpJob | null>(null);
  /** The first answer has come, so `job` can be trusted. */
  checked = $state(false);
  /** Said once when a load this tab watched has finished. */
  announcement = $state<string | null>(null);
  loading = $derived(this.job !== null && this.job.type !== "dump_download");
  /** The share of the dump the load has read, or of the download that has arrived. */
  fraction = $derived(fractionOf(this.job));
  #timer: ReturnType<typeof setTimeout> | null = null;

  async check(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const watched = this.job;
    try {
      const { jobs } = await api.getJobs();
      this.job = runningDumpJob(jobs);
      this.checked = true;
      if (watched && watched.type !== "dump_download" && !this.loading)
        await this.#announce(jobs.find((job) => job.id === watched.id));
    } catch {
      // The header says the server is unreachable; the next start checks again.
    }
    if (this.job) this.#timer = setTimeout(() => void this.check(), POLL_MS);
  }

  async #announce(finished: Job | undefined): Promise<void> {
    await stats.refresh();
    if (finished?.status !== "done" || finished.type === "dump_download") return;
    const loaded = stats.value?.universe.releases ?? 0;
    const toDig = stats.value?.remaining ?? 0;
    this.announcement = `The catalogue is in: ${formatCount(loaded)} releases, ${formatCount(toDig)} records to dig.`;
  }
}

function runningDumpJob(jobs: Job[]): DumpJob | null {
  const running = jobs.filter(
    (job): job is DumpJob =>
      DUMP_JOBS.has(job.type) && (job.status === "running" || job.status === "queued"),
  );
  return running.find((job) => job.type !== "dump_download") ?? running[0] ?? null;
}

function fractionOf(job: DumpJob | null): number | null {
  if (!job?.progress) return null;
  const progress = job.progress;
  if ("receivedBytes" in progress)
    return progress.totalBytes ? progress.receivedBytes / progress.totalBytes : null;
  return progress.bytesRead !== null && progress.totalBytes
    ? progress.bytesRead / progress.totalBytes
    : null;
}

export const loadStatus = new LoadStatusStore();
