import type { QueueItem, ReleaseDetail } from "../../shared/api.ts";

export interface EnrichAheadDeps {
  /** Has the server fetch the release from Discogs; null when the answer no longer applies. */
  enrich(releaseId: number): Promise<ReleaseDetail | null>;
  /** Receives each enriched release as it arrives. */
  apply(detail: ReleaseDetail): void;
}

/**
 * Enriches the records coming up, one request at a time, so their prices, want counts and videos
 * are fresh when they play. Each release is tried once: a failure (Discogs down, a removed
 * release) is not retried, and the record keeps the data it has.
 */
export class EnrichAhead {
  #deps: EnrichAheadDeps;
  #tried = new Set<number>();
  #waiting: number[] = [];
  #running = false;
  #stopped = false;

  constructor(deps: EnrichAheadDeps) {
    this.#deps = deps;
  }

  /** Enriches the records among these that have no market data yet, in order. */
  request(items: QueueItem[]): void {
    const wanted = new Set(items.map((item) => item.id));
    // Records that left the window before their turn may be asked for again later.
    for (const releaseId of this.#waiting)
      if (!wanted.has(releaseId)) this.#tried.delete(releaseId);
    this.#waiting = this.#waiting.filter((releaseId) => wanted.has(releaseId));
    for (const item of items) {
      if (item.enrichedAt !== null || this.#tried.has(item.id)) continue;
      this.#tried.add(item.id);
      this.#waiting.push(item.id);
    }
    void this.#drain();
  }

  /** Drops what is waiting; a request in flight still completes but is not applied. */
  stop(): void {
    this.#stopped = true;
    this.#waiting = [];
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      let releaseId = this.#waiting.shift();
      while (releaseId !== undefined && !this.#stopped) {
        const detail = await this.#deps.enrich(releaseId).catch(() => null);
        if (detail && !this.#stopped) this.#deps.apply(detail);
        releaseId = this.#waiting.shift();
      }
    } finally {
      this.#running = false;
    }
  }
}
