import type { QueueItem } from "../../shared/api.ts";
import type { QueueScope } from "../../shared/scope.ts";
import type { Api } from "../api.ts";
import type { CurrentCheck } from "../async.ts";

/** The most records one read asks for; the server refuses more. */
const MAX_QUEUE_LIMIT = 5000;

/**
 * An answer from the queue, and the records it may be wrong about: those with a verdict or undo
 * unanswered when it was asked for, or written since.
 */
export interface QueueRead {
  items: QueueItem[];
  /** The server has nothing beyond these. */
  complete: boolean;
  unsettled: Set<string>;
}

export interface QueueReadRequest {
  /** How many records to ask for. */
  wanted: number;
  /** Triage keys the session holds already, which the server leaves out. */
  held: string[];
  scope: QueueScope | null;
  /** Whether the queue the read was for is still the session's; only then is its seed kept. */
  isCurrent: CurrentCheck;
}

/**
 * Reads of the queue, one at a time, that know which records have a verdict or undo on its way
 * to the server and so may be reported wrongly.
 */
export class QueueReads {
  /** The queue order's seed, kept so a resumed session reads the queue in the same order. */
  seed: number | null = null;
  #api: Pick<Api, "getQueue">;
  #inFlight: Promise<void> | null = null;
  /** Verdicts and undos the server has not answered yet, counted by triage key. */
  #unanswered = new Map<string, number>();
  /** For each read in flight, the keys written since it was sent. */
  #openReads = new Set<Set<string>>();

  constructor(api: Pick<Api, "getQueue">) {
    this.#api = api;
  }

  /** The read running now, a refill or a reorder; null when none runs. */
  get inFlight(): Promise<void> | null {
    return this.#inFlight;
  }

  /** A new queue: its reads start in the seed's order, and the read in flight is not waited for. */
  restart(seed: number | null): void {
    this.seed = seed;
    this.#inFlight = null;
  }

  /** Runs a read; a refill asked for meanwhile waits for it through `inFlight`. */
  run(read: () => Promise<void>): Promise<void> {
    const tracked: Promise<void> = read().finally(() => {
      if (this.#inFlight === tracked) this.#inFlight = null;
    });
    this.#inFlight = tracked;
    return tracked;
  }

  /**
   * A verdict or undo on its way: until the server answers it, a read may not reflect it.
   * Returns what to call once it has answered.
   */
  startWrite(key: string): () => void {
    this.#unanswered.set(key, (this.#unanswered.get(key) ?? 0) + 1);
    for (const written of this.#openReads) written.add(key);
    return () => {
      const left = (this.#unanswered.get(key) ?? 1) - 1;
      if (left > 0) this.#unanswered.set(key, left);
      else this.#unanswered.delete(key);
    };
  }

  /**
   * Asks for up to `wanted` records in the queue's order, beyond those held and those with a write
   * unanswered, which the server leaves out; a shorter answer means it has no more.
   */
  async read(request: QueueReadRequest): Promise<QueueRead> {
    const unsettled = new Set(this.#unanswered.keys());
    const limit = Math.min(MAX_QUEUE_LIMIT, request.wanted);
    this.#openReads.add(unsettled);
    try {
      const response = await this.#api.getQueue({
        limit,
        exclude: [...unsettled, ...request.held],
        scope: request.scope ?? undefined,
        seed: this.seed ?? undefined,
      });
      if (request.isCurrent()) this.seed = response.seed;
      return { items: response.items, complete: response.items.length < limit, unsettled };
    } finally {
      this.#openReads.delete(unsettled);
    }
  }
}
