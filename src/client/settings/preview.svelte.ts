import type { Stats } from "../../shared/api.ts";
import type { Filters } from "../../shared/config.ts";
import { api, type Api } from "../api.ts";
import { Generation, type CurrentCheck } from "../async.ts";

export class FilterPreview {
  value = $state<Stats | null>(null);
  #client: Api;
  #loads = new Generation();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: Api = api) {
    this.#client = client;
  }

  update(filters: Filters | null): void {
    this.destroy();
    this.value = null;
    if (!filters) return;
    const isCurrent = this.#loads.current();
    this.#timer = setTimeout(() => void this.#load(filters, isCurrent), 300);
  }

  destroy(): void {
    this.#loads.invalidate();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #load(filters: Filters, isCurrent: CurrentCheck): Promise<void> {
    try {
      const value = await this.#client.getStats({ filters });
      if (isCurrent()) this.value = value;
    } catch {
      if (isCurrent()) this.value = null;
    }
  }
}
