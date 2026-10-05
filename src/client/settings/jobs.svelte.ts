import type { Job } from "../../shared/types.ts";
import { api, type Api } from "../api.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

export class SettingsJobs {
  items = $state.raw<Job[]>([]);
  error = $state<string | null>(null);
  running = $derived(this.items.some((job) => job.status === "running" || job.status === "queued"));
  #api: Api;
  #refreshStats: () => Promise<void>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #version = 0;
  #closed = false;
  #loaded = false;

  constructor(client: Api = api, refreshStats: () => Promise<void> = () => stats.refresh()) {
    this.#api = client;
    this.#refreshStats = refreshStats;
  }

  async load(): Promise<void> {
    if (this.#closed) return;
    if (this.#timer) clearTimeout(this.#timer);
    const version = ++this.#version;
    const before = this.#loaded ? this.items : null;
    try {
      const response = await this.#api.getJobs();
      if (!this.#current(version)) return;
      this.items = response.jobs;
      this.error = null;
      // What a job imported or loaded shows in the counts, also when it ended between two reads.
      if (before && someJobEnded(before, this.items)) void this.#refreshStats();
      this.#loaded = true;
    } catch (error) {
      if (this.#current(version)) this.error = errorMessage(error);
    } finally {
      if (this.#current(version) && this.running) {
        this.#timer = setTimeout(() => void this.load(), 1000);
      }
    }
  }

  async cancel(job: Job): Promise<void> {
    await this.#api.cancelJob(job.id);
    await this.load();
  }

  destroy(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
  }

  #current(version: number): boolean {
    return !this.#closed && version === this.#version;
  }
}

/** A job has ended since the earlier read: it was running then, or started and ended in between. */
function someJobEnded(before: Job[], after: Job[]): boolean {
  return after.some((job) => {
    if (!ended(job)) return false;
    const earlier = before.find((candidate) => candidate.id === job.id);
    return earlier === undefined || !ended(earlier);
  });
}

function ended(job: Job): boolean {
  return job.status !== "running" && job.status !== "queued";
}
