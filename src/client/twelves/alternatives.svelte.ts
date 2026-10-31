import type {
  AddAlternativesBatch,
  AddAlternativesInput,
  AlternativeAdditions,
  AlternativeOptions,
  AlternativesPreview,
  AlternativesProgress,
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

/** How often the dialog asks for the progress of the batch it is adding. */
const POLL_MS = 1000;

export class AlternativesPreviewState {
  entries = $state<PreviewEntry[]>([]);
  errors = $state<string[]>([]);
  results = $state<AlternativeAdditions[]>([]);
  reading = $state(false);
  writing = $state(false);
  progress = $state("");
  /** What the progress bar counts: the records checked, or the pressings the batch finished. */
  meter = $state<{ done: number; total: number } | null>(null);
  inputs = $state<AddAlternativesInput[]>([]);
  #read: AbortController | null = null;
  #closed = new AbortController();
  #client: Pick<Api, "previewAlternatives" | "getAlternativesProgress">;

  constructor(client: Pick<Api, "previewAlternatives" | "getAlternativesProgress"> = api) {
    this.#client = client;
  }

  destroy(): void {
    this.#read?.abort();
    this.#closed.abort();
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
    this.meter = { done: 0, total: items.length };
    try {
      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) return;
        this.progress = `Checking record ${index + 1} of ${items.length}…`;
        await this.#readOne(item, options, controller.signal);
        if (!controller.signal.aborted) this.meter = { done: index + 1, total: items.length };
      }
    } finally {
      if (!controller.signal.aborted) {
        this.reading = false;
        this.meter = null;
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

  /** Adds the selection in one batch; a retry sends the same operations again. */
  async add(
    options: AlternativeOptions,
    write: (batch: AddAlternativesBatch) => Promise<AlternativeAdditions[]>,
  ): Promise<void> {
    if (this.writing || this.reading) return;
    if (this.inputs.length === 0) this.inputs = this.#selectedInputs(options);
    if (this.inputs.length === 0) return;
    this.writing = true;
    this.meter = null;
    this.progress = "Adding the selected pressings to Discogs…";
    const batch = { batchId: crypto.randomUUID(), additions: $state.snapshot(this.inputs) };
    const request = write(batch);
    void this.#followBatch(batch.batchId, request);
    try {
      this.results = await request;
      const failed = this.results.some((result) => result.errors.length > 0);
      this.progress = failed
        ? "Some pressings were not added. Retry the failed additions, or close and press Z to undo."
        : "Selected pressings are on your wantlist. Close and press Z to undo the additions.";
    } catch (error) {
      this.progress = `Could not confirm the additions: ${errorMessage(error)}. Press Retry additions to try again.`;
    } finally {
      this.writing = false;
      this.meter = null;
    }
  }

  #selectedInputs(options: AlternativeOptions): AddAlternativesInput[] {
    return this.entries
      .filter((entry) => entry.selected.length > 0)
      .map((entry) => ({
        releaseId: entry.preview.source.id,
        options: { ...options },
        releaseIds: [...entry.selected],
        operationId: crypto.randomUUID(),
        automatic: false,
      }));
  }

  /**
   * Shows the batch's progress until its request settles or the dialog closes. The request's
   * answer replaces the count, so a poll answered after it is dropped.
   */
  async #followBatch(batchId: string, request: Promise<unknown>): Promise<void> {
    let settled = false;
    const finished = request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const following = () => !settled && !this.#closed.signal.aborted;
    while (following()) {
      await pause(POLL_MS, finished);
      const progress = following() ? await this.#batchProgress(batchId) : null;
      if (progress && following()) {
        this.meter = progress;
        this.progress = `Adding the selected pressings to Discogs: ${progress.done} of ${progress.total}…`;
      }
    }
  }

  /** A failed poll keeps the last count; the batch's own answer reports what failed. */
  async #batchProgress(batchId: string): Promise<AlternativesProgress | null> {
    try {
      return await this.#client.getAlternativesProgress(batchId);
    } catch {
      return null;
    }
  }
}

/** Resolves after `ms`, or as soon as `settled` does. */
function pause(ms: number, settled: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void settled.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
