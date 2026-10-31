import {
  alternativesEnabled,
  type AddAlternativesInput,
  type AlternativeOptions,
} from "../../shared/alternative-pressings.ts";
import type { QueueItem } from "../../shared/api.ts";
import type { Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

type AlternativesApi = Pick<
  Api,
  "previewAlternatives" | "addAlternativeWants" | "undoAlternativeWants"
>;

export class AlternativeWants {
  #api: AlternativesApi;
  #operations = new Map<string, AddAlternativesInput>();
  #closed = new AbortController();
  #flash: (message: string) => void;

  constructor(api: AlternativesApi, flash: (message: string) => void) {
    this.#api = api;
    this.#flash = flash;
  }

  destroy(): void {
    this.#closed.abort();
  }

  async add(
    item: QueueItem,
    options: AlternativeOptions,
    stillWanted: () => boolean,
  ): Promise<void> {
    if (!alternativesEnabled(options) || this.#closed.signal.aborted) return;
    try {
      let input = this.#operations.get(item.triageKey);
      if (!input) {
        const preview = await this.#api.previewAlternatives(
          { releaseId: item.id, options },
          this.#closed.signal,
        );
        if (this.#closed.signal.aborted || !stillWanted()) return;
        const releaseIds = preview.candidates
          .filter((candidate) => candidate.match === "matching")
          .map((candidate) => candidate.release.id);
        if (preview.errors.length > 0)
          this.#flash(
            `Could not check some alternative pressings of ${item.title}. Review them in Twelves.`,
          );
        if (releaseIds.length === 0) return;
        input = {
          releaseId: item.id,
          options,
          releaseIds,
          operationId: crypto.randomUUID(),
          automatic: true,
        };
        this.#operations.set(item.triageKey, input);
      }
      if (this.#closed.signal.aborted || !stillWanted()) return;
      const [result] = await this.#api.addAlternativeWants({ additions: [input] });
      if (this.#closed.signal.aborted || !result) return;
      if (result.errors.length > 0)
        this.#flash(
          `Want saved, but Digga could not add some alternative pressings of ${item.title}: ${result.errors.map((failure) => `${failure.releaseId}: ${failure.error}`).join("; ")}. Review them in Twelves.`,
        );
    } catch (error) {
      if (!this.#closed.signal.aborted)
        this.#flash(
          `Want saved, but Digga could not confirm the alternative pressings of ${item.title}: ${errorMessage(error)}. Review them in Twelves.`,
        );
    }
  }

  async undo(key: string): Promise<void> {
    const input = this.#operations.get(key);
    if (!input) return;
    const result = await this.#api.undoAlternativeWants(input.operationId);
    if (result.errors.length > 0)
      throw new Error(
        result.errors.map((failure) => `${failure.releaseId}: ${failure.error}`).join("; "),
      );
    this.#operations.delete(key);
  }
}
