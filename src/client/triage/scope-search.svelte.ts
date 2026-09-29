import type { ScopeMatch } from "../../shared/api.ts";
import type { Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

/** The server needs two characters; one would match most of the catalogue. */
export const SCOPE_SEARCH_MIN_LENGTH = 2;

/** Searches labels and artists as the user types. An answer to older text is dropped. */
export class ScopeSearch {
  text = $state("");
  matches = $state.raw<ScopeMatch[]>([]);
  searching = $state(false);
  error = $state<string | null>(null);

  #api: Pick<Api, "searchScopes">;
  #delayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #sequence = 0;

  constructor(api: Pick<Api, "searchScopes">, delayMs = 200) {
    this.#api = api;
    this.#delayMs = delayMs;
  }

  /** True once the text is long enough to search. */
  get active(): boolean {
    return this.text.trim().length >= SCOPE_SEARCH_MIN_LENGTH;
  }

  /** Takes new text and searches for it after a pause in typing. */
  update(text: string): void {
    this.text = text;
    this.#cancel();
    this.error = null;
    if (!this.active) {
      this.matches = [];
      this.searching = false;
      return;
    }
    this.searching = true;
    const sequence = this.#sequence;
    this.#timer = setTimeout(() => void this.#search(text.trim(), sequence), this.#delayMs);
  }

  clear(): void {
    this.update("");
  }

  #cancel(): void {
    this.#sequence += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #search(text: string, sequence: number): Promise<void> {
    this.#timer = null;
    try {
      const response = await this.#api.searchScopes(text);
      if (sequence !== this.#sequence) return;
      this.matches = response.items;
    } catch (error) {
      if (sequence !== this.#sequence) return;
      this.matches = [];
      this.error = errorMessage(error);
    }
    this.searching = false;
  }
}
