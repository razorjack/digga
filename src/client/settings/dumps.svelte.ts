import type { DumpsResponse } from "../../shared/api.ts";
import { api, type Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

/** The releases dumps in the dumps folder, which a download adds to. */
export class DumpFiles {
  value = $state<DumpsResponse | null>(null);
  error = $state<string | null>(null);
  newest = $derived(this.value?.files[0] ?? null);
  #client: Pick<Api, "getDumps">;
  #version = 0;

  constructor(client: Pick<Api, "getDumps"> = api) {
    this.#client = client;
  }

  async load(): Promise<void> {
    const version = ++this.#version;
    try {
      const response = await this.#client.getDumps();
      if (version !== this.#version) return;
      this.value = response;
      this.error = null;
    } catch (error) {
      if (version === this.#version) this.error = errorMessage(error);
    }
  }

  destroy(): void {
    this.#version += 1;
  }
}
