import { isActiveJob, type Job } from "../../shared/types.ts";
import { api, type Api } from "../api.ts";
import { Generation } from "../async.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

export const SAVE_BEFORE_JOB =
  "Save or discard your changes before starting a download, load or import.";

export class SettingsJobs {
  items = $state.raw<Job[]>([]);
  error = $state<string | null>(null);
  running = $derived(this.items.some(isActiveJob));
  #api: Api;
  #refreshStats: () => Promise<void>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #reads = new Generation();
  #loaded = false;

  constructor(client: Api = api, refreshStats: () => Promise<void> = () => stats.refresh()) {
    this.#api = client;
    this.#refreshStats = refreshStats;
  }

  async load(): Promise<void> {
    if (this.#reads.ended) return;
    if (this.#timer) clearTimeout(this.#timer);
    const isCurrent = this.#reads.next();
    const before = this.#loaded ? this.items : null;
    try {
      const response = await this.#api.getJobs();
      if (!isCurrent()) return;
      this.items = response.jobs;
      this.error = null;
      // What a job imported or loaded shows in the counts, also when it ended between two reads.
      if (before && someJobEnded(before, this.items)) void this.#refreshStats();
      this.#loaded = true;
    } catch (error) {
      if (isCurrent()) this.error = errorMessage(error);
    } finally {
      if (isCurrent() && this.running) {
        this.#timer = setTimeout(() => void this.load(), 1000);
      }
    }
  }

  async cancel(job: Job): Promise<void> {
    await this.#api.cancelJob(job.id);
    await this.load();
  }

  destroy(): void {
    this.#reads.end();
    if (this.#timer) clearTimeout(this.#timer);
  }
}

/** A job has ended since the earlier read: it was running then, or started and ended in between. */
function someJobEnded(before: Job[], after: Job[]): boolean {
  return after.some((job) => {
    if (isActiveJob(job)) return false;
    const earlier = before.find((candidate) => candidate.id === job.id);
    return earlier === undefined || isActiveJob(earlier);
  });
}
