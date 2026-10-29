import { AlternativeWants } from "./alternative-wants.ts";
import type { AlternativeOptions } from "../../shared/alternative-pressings.ts";
import type { QueueItem } from "../../shared/api.ts";
import { isWantlistVerdict } from "../../shared/wantlist.ts";
import { type Api, ApiRequestError } from "../api.ts";
import { SerialQueue } from "../async.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage } from "../stores.svelte.ts";

/** How a push ended: on the wantlist, given up, or moot because the record is no longer a want. */
export type PushOutcome = "done" | "failed" | null;

export interface WantlistSyncOptions {
  api: Pick<
    Api,
    | "getRelease"
    | "pushToWantlist"
    | "removeFromWantlist"
    | "previewAlternatives"
    | "addAlternativeWants"
    | "undoAlternativeWants"
  >;
  alternativeOptions: () => AlternativeOptions;
  /** The waits before each new try of a failed push. */
  retryDelaysMs: number[];
  /** The newest verdict the session gave the record; undefined when it gave none. */
  latestVerdict: (key: string) => TriageStatus | undefined;
  flash: (message: string) => void;
}

/**
 * Keeps the Discogs wantlist in line with the session's verdicts, record by record. The calls run
 * one at a time and decide when they run, not when they were asked for, so any mix of A, Z and
 * slow requests ends with the release on the wantlist exactly when its latest verdict is a want or
 * a grail.
 */
export class WantlistSync {
  #options: WantlistSyncOptions;
  #alternatives: AlternativeWants;
  /** Release ids by triage key that this session put on the Discogs wantlist. */
  #onWantlist = new Map<string, number[]>();
  /** The pressings a record taken into a round had on the wantlist, which undo restores. */
  #roundWants = new Map<string, number[]>();
  #writes = new SerialQueue();
  #retryTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  #ended = false;

  constructor(options: WantlistSyncOptions) {
    this.#options = options;
    this.#alternatives = new AlternativeWants(options.api, options.flash);
  }

  /** Stops the retries; a call already sent finishes, but nothing more is sent. */
  destroy(): void {
    this.#ended = true;
    this.#alternatives.destroy();
    for (const [timer, resolve] of this.#retryTimers) {
      clearTimeout(timer);
      resolve();
    }
    this.#retryTimers.clear();
  }

  /** A record taken into a round, with the pressings it has on the wantlist now. */
  rememberRoundRecord(key: string, wantlistReleaseIds: number[]): void {
    this.#roundWants.set(key, [...wantlistReleaseIds]);
    if (wantlistReleaseIds.length > 0) this.#onWantlist.set(key, [...wantlistReleaseIds]);
    else this.#onWantlist.delete(key);
  }

  forgetRounds(): void {
    this.#roundWants.clear();
  }

  /**
   * Puts a want or grail on the wantlist, trying again after each of the retry delays while it
   * fails on the way or in Discogs. Each try decides from the verdicts when it runs, so a want
   * undone meanwhile is not pushed.
   */
  async push(item: QueueItem, onRetry: (retryInMs: number) => void): Promise<PushOutcome> {
    for (let tries = 0; ; tries += 1) {
      try {
        await this.#sync(item);
        return this.#onWantlist.has(item.triageKey) ? "done" : null;
      } catch (error) {
        if (this.#ended) return null;
        const delayMs = this.#options.retryDelaysMs[tries];
        if (delayMs === undefined || !mayPassLater(error)) {
          this.#options.flash(
            `${item.artistDisplay} – ${item.title} is not on the Discogs wantlist: ${errorMessage(error)}. A in Twelves tries again.`,
          );
          return "failed";
        }
        onRetry(delayMs);
        await this.#waitBeforeRetry(delayMs);
        if (this.#ended) return null;
      }
    }
  }

  /** Takes the record's pressings off the wantlist unless its latest verdict is a want again. */
  async takeOff(item: QueueItem): Promise<void> {
    try {
      if ((await this.#sync(item)) !== "removed") return;
      if (this.#ended) return;
      this.#options.flash("Taken off your Discogs wantlist again.");
    } catch (error) {
      if (this.#ended) return;
      this.#options.flash(`Still on your Discogs wantlist: ${errorMessage(error)}`);
    }
  }

  #sync(item: QueueItem): Promise<"added" | "removed" | null> {
    return this.#writes.run(async (): Promise<"added" | "removed" | null> => {
      if (this.#ended) return null;
      const latest = this.#options.latestVerdict(item.triageKey);
      if (latest === undefined || !isWantlistVerdict(latest))
        await this.#alternatives.undo(item.triageKey);
      if (!this.#wanted(item.triageKey)) return this.#removeWantedPressings(item.triageKey);
      const outcome = await this.#addWantedPressings(item);
      if (latest !== undefined && isWantlistVerdict(latest))
        await this.#alternatives.add(item, this.#options.alternativeOptions(), () => {
          const current = this.#options.latestVerdict(item.triageKey);
          return current !== undefined && isWantlistVerdict(current);
        });
      return outcome;
    });
  }

  /** The newest verdict for the record is a want or a grail, or the round found it wanted. */
  #wanted(key: string): boolean {
    const latest = this.#options.latestVerdict(key);
    if (latest !== undefined) return isWantlistVerdict(latest);
    return (this.#roundWants.get(key)?.length ?? 0) > 0;
  }

  async #addWantedPressings(item: QueueItem): Promise<"added" | null> {
    const key = item.triageKey;
    const held = this.#onWantlist.get(key) ?? [];
    const original = this.#roundWants.get(key) ?? [];
    const wanted = original.length > 0 ? original : [item.id];
    const missing = wanted.filter((id) => !held.includes(id));
    if (missing.length === 0) return null;
    // Twelves may have changed the verdict while the push waited for earlier ones.
    const saved = await this.#options.api.getRelease(item.id);
    if (saved.verdict === null || !isWantlistVerdict(saved.verdict.status)) return null;
    for (const releaseId of missing) {
      if (this.#ended || !this.#wanted(key)) return null;
      await this.#options.api.pushToWantlist(releaseId);
      if (this.#ended) return null;
      held.push(releaseId);
      this.#onWantlist.set(key, held);
    }
    return "added";
  }

  async #removeWantedPressings(key: string): Promise<"removed" | null> {
    const held = this.#onWantlist.get(key) ?? [];
    if (held.length === 0) return null;
    for (const releaseId of held) {
      if (this.#ended || this.#wanted(key)) return null;
      await this.#options.api.removeFromWantlist(releaseId);
      if (this.#ended) return null;
      const remaining = (this.#onWantlist.get(key) ?? []).filter((id) => id !== releaseId);
      if (remaining.length > 0) this.#onWantlist.set(key, remaining);
      else this.#onWantlist.delete(key);
    }
    return "removed";
  }

  /** Resolves after the delay, or at once when the sync is destroyed. */
  #waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#retryTimers.delete(timer);
        resolve();
      }, delayMs);
      this.#retryTimers.set(timer, resolve);
    });
  }
}

/** A push that failed on the way or in Discogs may pass later; one the server refused (4xx) will not. */
function mayPassLater(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500;
}
