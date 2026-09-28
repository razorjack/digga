import type { Stats } from "../../shared/api.ts";
import type { Filters } from "../../shared/config.ts";
import { api, type Api } from "../api.ts";

export class FilterPreview {
  value = $state<Stats | null>(null);
  #client: Api;
  #version = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: Api = api) {
    this.#client = client;
  }

  update(filters: Filters | null): void {
    this.destroy();
    this.value = null;
    if (!filters) return;
    const version = this.#version;
    this.#timer = setTimeout(() => void this.#load(filters, version), 300);
  }

  destroy(): void {
    this.#version += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #load(filters: Filters, version: number): Promise<void> {
    try {
      const value = await this.#client.getStats({ filters });
      if (version === this.#version) this.value = value;
    } catch {
      if (version === this.#version) this.value = null;
    }
  }
}
