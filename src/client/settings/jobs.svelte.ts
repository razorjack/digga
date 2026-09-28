import type { Job } from "../../shared/types.ts";
import { api, type AppApi } from "../api.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

export class SettingsJobs {
  items = $state.raw<Job[]>([]);
  error = $state<string | null>(null);
  running = $derived(this.items.some((job) => job.status === "running" || job.status === "queued"));
  #api: AppApi;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #version = 0;
  #closed = false;

  constructor(client: AppApi = api) {
    this.#api = client;
  }

  async load(): Promise<void> {
    if (this.#closed) return;
    if (this.#timer) clearTimeout(this.#timer);
    const version = ++this.#version;
    const generation = this.#api.generation;
    const wasRunning = this.running;
    try {
      const response = await this.#api.getJobs();
      if (!this.#current(version, generation)) return;
      this.items = response.jobs.slice(0, 12);
      this.error = null;
      if (wasRunning && !this.running) void stats.refresh();
    } catch (error) {
      if (this.#current(version, generation)) this.error = errorMessage(error);
    } finally {
      if (this.#current(version, generation) && this.running) {
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

  #current(version: number, generation: number): boolean {
    return !this.#closed && version === this.#version && generation === this.#api.generation;
  }
}
