import type { DumpFile, DumpsResponse } from "../../shared/api.ts";
import { formatDay } from "../../shared/display.ts";
import { api, type Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

/** The releases dumps in the dumps folder, which a download adds to. */
export class DumpFiles {
  value = $state<DumpsResponse | null>(null);
  error = $state<string | null>(null);
  newest = $derived(this.value?.files[0] ?? null);
  #client: Pick<Api, "getDumps" | "deleteDump">;
  #version = 0;

  constructor(client: Pick<Api, "getDumps" | "deleteDump"> = api) {
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

  /** Deletes the dump; throws what the server answered, and the listing stays as it was. */
  async delete(name: string): Promise<void> {
    const version = ++this.#version;
    const response = await this.#client.deleteDump(name);
    if (version !== this.#version) return;
    this.value = response;
    this.error = null;
  }

  destroy(): void {
    this.#version += 1;
  }
}

/** What a dump in the folder is for: the one the library came from, one to load, or neither. */
export function dumpUse(file: DumpFile, newest: DumpFile, loadedDate: string | null): string {
  if (file.date === loadedDate) return "the library was loaded from it";
  if (file.date < newest.date)
    return `nothing needs it: the ${formatDay(newest.date)} dump is newer`;
  return "not loaded yet";
}
