import type { ReleaseDetail } from "../../shared/api.ts";
import type { Api } from "../api.ts";
import { errorMessage } from "../stores.svelte.ts";

/** Prune once this many details are held. */
const PRUNE_AT = 60;

export interface DetailCacheOptions {
  api: Pick<Api, "getRelease">;
  /** Resolves once the writes sent so far are answered, so a read sees them. */
  writesSettled: () => Promise<void>;
  /** The owner is destroyed; answers that arrive later change nothing. */
  ended: () => boolean;
}

/** The release details Triage has read, by release id, and the reads that failed. */
export class DetailCache {
  details = $state.raw<ReadonlyMap<number, ReleaseDetail>>(new Map());
  errors = $state.raw<ReadonlyMap<number, string>>(new Map());
  #options: DetailCacheOptions;
  /** The read in flight for each release; a newer read or forget() makes an older one stale. */
  #reads = new Map<number, symbol>();

  constructor(options: DetailCacheOptions) {
    this.#options = options;
  }

  get(id: number): ReleaseDetail | null {
    return this.details.get(id) ?? null;
  }

  /** Reads the releases neither held, being read, nor failed. */
  prefetch(ids: number[]): void {
    for (const id of ids) {
      if (this.details.has(id) || this.#reads.has(id) || this.errors.has(id)) continue;
      void this.load(id);
    }
  }

  /** Reads the release again after a failure; resolves to the detail, or null. */
  retry(id: number): Promise<ReleaseDetail | null> {
    this.errors = withoutKeys(this.errors, [id]);
    return this.load(id);
  }

  /** Reads the release once the writes before it are answered; null when it failed or is stale. */
  async load(id: number): Promise<ReleaseDetail | null> {
    const read = Symbol();
    this.#reads.set(id, read);
    const isCurrent = () => !this.#options.ended() && this.#reads.get(id) === read;
    try {
      await this.#options.writesSettled();
      if (!isCurrent()) return null;
      const detail = await this.#options.api.getRelease(id);
      if (!isCurrent()) return null;
      this.set(id, detail);
      return detail;
    } catch (error) {
      if (isCurrent()) this.errors = new Map(this.errors).set(id, errorMessage(error));
      return null;
    } finally {
      if (this.#reads.get(id) === read) this.#reads.delete(id);
    }
  }

  set(id: number, detail: ReleaseDetail): void {
    this.details = new Map(this.details).set(id, detail);
  }

  /** Changes a held detail; does nothing for a release not held. */
  update(id: number, change: (detail: ReleaseDetail) => ReleaseDetail): void {
    const detail = this.details.get(id);
    if (detail) this.set(id, change(detail));
  }

  /** Drops the releases' details, errors and reads in flight, so the next read starts afresh. */
  forget(ids: number[]): void {
    for (const id of ids) this.#reads.delete(id);
    this.details = withoutKeys(this.details, ids);
    this.errors = withoutKeys(this.errors, ids);
  }

  /** Keeps only the details of `keep` once many are held. */
  prune(keep: ReadonlySet<number>): void {
    if (this.details.size < PRUNE_AT) return;
    this.details = new Map([...this.details].filter(([id]) => keep.has(id)));
  }
}

function withoutKeys<Value>(map: ReadonlyMap<number, Value>, ids: number[]): Map<number, Value> {
  const kept = new Map(map);
  for (const id of ids) kept.delete(id);
  return kept;
}
