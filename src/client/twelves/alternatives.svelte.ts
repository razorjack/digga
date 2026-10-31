import type {
  AddAlternativesInput,
  AlternativeAdditions,
  AlternativeOptions,
  AlternativesPreview,
} from "../../shared/alternative-pressings.ts";
import type { TwelvesItem } from "../../shared/api.ts";
import { isWantlistVerdict } from "../../shared/wantlist.ts";
import { api, type Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";
import { releaseIdOf } from "./model.ts";

export function canExpandWants(item: TwelvesItem): boolean {
  if (releaseIdOf(item) === null || item.membership.owned || item.membership.wantRemoved)
    return false;
  return (
    item.membership.onWantlist || (item.verdict !== null && isWantlistVerdict(item.verdict.status))
  );
}

export interface PreviewEntry {
  preview: AlternativesPreview;
  selected: number[];
}

export class AlternativesPreviewState {
  entries = $state<PreviewEntry[]>([]);
  errors = $state<string[]>([]);
  results = $state<AlternativeAdditions[]>([]);
  reading = $state(false);
  writing = $state(false);
  progress = $state("");
  inputs = $state<AddAlternativesInput[]>([]);
  #read: AbortController | null = null;
  #client: Pick<Api, "previewAlternatives">;

  constructor(client: Pick<Api, "previewAlternatives"> = api) {
    this.#client = client;
  }

  destroy(): void {
    this.#read?.abort();
  }

  async read(items: TwelvesItem[], options: AlternativeOptions): Promise<void> {
    this.#read?.abort();
    const controller = new AbortController();
    this.#read = controller;
    this.entries = [];
    this.errors = [];
    this.results = [];
    this.inputs = [];
    this.reading = true;
    try {
      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) return;
        this.progress = `Checking record ${index + 1} of ${items.length}…`;
        await this.#readOne(item, options, controller.signal);
      }
    } finally {
      if (!controller.signal.aborted) {
        this.reading = false;
        this.progress = "Preview ready. Existing wants will be kept.";
      }
    }
  }

  async #readOne(
    item: TwelvesItem,
    options: AlternativeOptions,
    signal: AbortSignal,
  ): Promise<void> {
    const releaseId = releaseIdOf(item);
    if (releaseId === null) return;
    try {
      const preview = await this.#client.previewAlternatives({ releaseId, options }, signal);
      if (signal.aborted) return;
      const selected = preview.candidates
        .filter((candidate) => candidate.match === "matching" && !candidate.onWantlist)
        .map((candidate) => candidate.release.id);
      this.entries.push({ preview, selected });
    } catch (error) {
      if (!signal.aborted)
        this.errors.push(`${item.release?.title ?? releaseId}: ${errorMessage(error)}`);
    }
  }

  async add(
    options: AlternativeOptions,
    write: (inputs: AddAlternativesInput[]) => Promise<AlternativeAdditions[]>,
  ): Promise<void> {
    if (this.writing || this.reading) return;
    if (this.inputs.length === 0)
      this.inputs = this.entries
        .filter((entry) => entry.selected.length > 0)
        .map((entry) => ({
          releaseId: entry.preview.source.id,
          options: { ...options },
          releaseIds: [...entry.selected],
          operationId: crypto.randomUUID(),
          automatic: false,
        }));
    if (this.inputs.length === 0) return;
    this.writing = true;
    this.progress = "Adding selected pressings to Discogs…";
    try {
      this.results = await write($state.snapshot(this.inputs));
      const failed = this.results.some((result) => result.errors.length > 0);
      this.progress = failed
        ? "Some pressings were not added. Retry the failed additions, or close and press Z to undo."
        : "Selected pressings are on your wantlist. Close and press Z to undo the additions.";
    } catch (error) {
      this.progress = `Could not confirm the additions: ${errorMessage(error)}. Press Retry additions to try again.`;
    } finally {
      this.writing = false;
    }
  }
}
