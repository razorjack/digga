import type { QueueItem, ReleaseDetail, TwelvesItem } from "../../shared/api.ts";
import type { TrackMark, Verdict } from "../../shared/types.ts";
import { type Api, api } from "../api.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

type HistoryEntry =
  | {
      kind: "verdict";
      item: QueueItem;
      status: TriageStatus;
      /** The verdict this one replaced (a snoozed record heard again); undo restores it. */
      previous: Verdict | null;
    }
  | { kind: "pass"; item: QueueItem };

/** What the slip under the player shows: the last thing that happened to a release. */
export type Slip =
  | {
      kind: "verdict";
      item: QueueItem;
      status: TriageStatus;
      id: number;
      push: "pending" | "done" | "failed" | null;
    }
  | { kind: "pass"; item: QueueItem; id: number; stays: "queue" | "snoozed" }
  | { kind: "undo"; item: QueueItem; undone: TriageStatus | "pass"; id: number };

/** Snoozed records heard again, ahead of the queue, which resumes where it was afterwards. */
export interface Round {
  total: number;
}

/** Fetch more of the queue when fewer releases than this are buffered. */
const REFILL_BELOW = 8;
/** Release details fetched ahead of the cursor (the next one also feeds the preloading deck). */
const PREFETCH = 3;
const MAX_QUEUE_LIMIT = 5000;
/** A want waits this long before the wantlist push, so a quick Z cancels it instead. */
const PUSH_GRACE_MS = 1500;

export class TriageSession {
  upcoming = $state.raw<QueueItem[]>([]);
  passed = $state.raw<QueueItem[]>([]);
  history = $state.raw<HistoryEntry[]>([]);
  details = $state.raw<Map<number, ReleaseDetail>>(new Map());
  detailErrors = $state.raw<Map<number, string>>(new Map());
  status = $state<"loading" | "ready" | "error">("loading");
  error = $state<string | null>(null);
  /** The server has nothing beyond what is buffered. */
  exhausted = $state(false);
  slip = $state.raw<Slip | null>(null);
  flash = $state<string | null>(null);
  round = $state.raw<Round | null>(null);

  current = $derived(this.upcoming[0] ?? null);
  next = $derived(this.upcoming[1] ?? null);
  currentDetail = $derived(this.current ? (this.details.get(this.current.id) ?? null) : null);
  nextDetail = $derived(this.next ? (this.details.get(this.next.id) ?? null) : null);
  finished = $derived(this.status === "ready" && this.upcoming.length === 0 && this.exhausted);

  #batch = 200;
  #loading = new Set<number>();
  #refilling: Promise<void> | null = null;
  /** Bumped by start(); a refill from an older generation drops its result. */
  #generation = 0;
  /** The api mode the history and details belong to; see AppApi.generation. */
  #apiGeneration = api.generation;
  /** Release ids by triage key, for wants whose wantlist push went through. */
  #pushed = new Map<string, number>();
  /** The queue as it was when a round started. */
  #queueBeforeRound: { upcoming: QueueItem[]; passed: QueueItem[]; exhausted: boolean } | null =
    null;
  /** Verdicts of the records taken into rounds, by triage key. */
  #roundVerdicts = new Map<string, Verdict>();
  #writes: Promise<unknown> = Promise.resolve();
  #slipSeq = 0;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  async start(batch: number): Promise<void> {
    // Undo and the details' overlays belong to the mode they were made in.
    if (api.generation !== this.#apiGeneration) this.#forget();
    this.#batch = batch;
    this.#generation += 1;
    this.#refilling = null;
    this.status = "loading";
    this.error = null;
    this.upcoming = [];
    this.exhausted = false;
    this.round = null;
    this.#queueBeforeRound = null;
    try {
      await this.#refill();
      this.status = "ready";
    } catch (e) {
      this.status = "error";
      this.error = errorMessage(e);
    }
  }

  judge(status: TriageStatus): void {
    const item = this.current;
    if (!item) return;
    const client = api.pinned();
    const previous = this.#roundVerdicts.get(item.triageKey) ?? null;
    const entry: HistoryEntry = { kind: "verdict", item, status, previous };
    this.upcoming = this.upcoming.slice(1);
    this.history = [...this.history, entry];
    const id = ++this.#slipSeq;
    this.slip = {
      kind: "verdict",
      item,
      status,
      id,
      push: status === "accepted" ? "pending" : null,
    };
    stats.session += 1;
    this.#bumpStats(status, previous, 1);
    this.#afterMove();
    void this.#write(async () => {
      try {
        await client.postVerdict({
          key: item.triageKey,
          status,
          releaseId: item.id,
          notes: previous?.notes ?? null,
        });
      } catch (e) {
        this.#flash(`The verdict was not saved: ${errorMessage(e)}`);
        stats.refreshSoon(0);
        // Already undone: nothing to put back.
        if (!this.history.includes(entry)) return;
        this.history = this.history.filter((h) => h !== entry);
        this.upcoming = [item, ...this.upcoming.filter((i) => i.triageKey !== item.triageKey)];
        stats.session -= 1;
        this.slip = null;
        return;
      }
      stats.refreshSoon();
      // Outside the write chain: a slow Discogs push must not hold back the next verdicts.
      if (status === "accepted") void this.#pushToWantlist(entry, id, client);
    });
  }

  /** N: leave the release undecided and move on; it comes back when the queue goes round. */
  pass(): void {
    const item = this.current;
    if (!item) {
      this.goRound();
      return;
    }
    this.upcoming = this.upcoming.slice(1);
    this.passed = [...this.passed, item];
    this.history = [...this.history, { kind: "pass", item }];
    this.slip = {
      kind: "pass",
      item,
      id: ++this.#slipSeq,
      stays: this.#roundVerdicts.has(item.triageKey) ? "snoozed" : "queue",
    };
    this.#afterMove();
  }

  /**
   * Puts snoozed records ahead of the queue to hear them again. Judging one replaces its
   * snoozed verdict, N leaves it snoozed, and the queue resumes after the last one.
   */
  startRound(items: TwelvesItem[]): void {
    const records = items.filter(
      (i): i is TwelvesItem & { release: QueueItem } =>
        i.release !== null && i.verdict.status === "snoozed",
    );
    if (records.length === 0) return;
    this.#queueBeforeRound ??= {
      upcoming: this.upcoming,
      passed: this.passed,
      exhausted: this.exhausted,
    };
    for (const r of records) this.#roundVerdicts.set(r.verdict.key, r.verdict);
    this.upcoming = records.map((r) => r.release);
    this.passed = [];
    this.exhausted = true;
    this.round = { total: records.length };
    this.status = "ready";
    this.slip = null;
    this.#afterMove();
  }

  /** Esc during a round, or its last record: back to the queue where it was. */
  endRound(): void {
    const saved = this.#queueBeforeRound;
    if (!this.round || !saved) return;
    this.#queueBeforeRound = null;
    this.round = null;
    const judged = new Set(
      this.history.filter((h) => h.kind === "verdict").map((h) => h.item.triageKey),
    );
    this.upcoming = saved.upcoming.filter((i) => !judged.has(i.triageKey));
    this.passed = saved.passed;
    this.exhausted = saved.exhausted;
    this.#afterMove();
  }

  /** At the end of the queue, starts again on the releases passed with N. */
  goRound(): void {
    if (this.upcoming.length > 0 || this.passed.length === 0) return;
    this.upcoming = this.passed;
    this.passed = [];
    this.slip = null;
    this.#afterMove();
  }

  undo(): void {
    const entry = this.history.at(-1);
    if (!entry) {
      this.#flash("Nothing to undo.");
      return;
    }
    const { item } = entry;
    this.history = this.history.slice(0, -1);
    if (entry.kind === "pass")
      this.passed = this.passed.filter((i) => i.triageKey !== item.triageKey);
    this.upcoming = [item, ...this.upcoming.filter((i) => i.triageKey !== item.triageKey)];
    this.slip = {
      kind: "undo",
      item,
      undone: entry.kind === "verdict" ? entry.status : "pass",
      id: ++this.#slipSeq,
    };
    this.#afterMove();
    if (entry.kind !== "verdict") return;
    stats.session -= 1;
    this.#bumpStats(entry.status, entry.previous, -1);
    const client = api.pinned();
    const pushedId = this.#pushed.get(item.triageKey);
    if (entry.status === "accepted" && pushedId !== undefined) {
      this.#pushed.delete(item.triageKey);
      void this.#removeFromWantlist(pushedId, client);
    }
    const { previous } = entry;
    void this.#write(async () => {
      try {
        if (previous)
          await client.postVerdict({
            key: previous.key,
            status: previous.status,
            source: previous.source,
            notes: previous.notes,
            releaseId: previous.releaseId,
            decidedAt: previous.decidedAt,
          });
        else await client.deleteVerdict(item.triageKey);
      } catch (e) {
        this.#flash(`Undo failed: ${errorMessage(e)}`);
      }
      stats.refreshSoon();
    });
  }

  /** Toggles a mark on a track; the same mark again clears it. */
  markTrack(releaseId: number, position: string, mark: TrackMark): void {
    const detail = this.details.get(releaseId);
    const track = detail?.tracks.find((t) => t.position === position);
    if (!detail || !track) return;
    const next = track.mark === mark ? null : mark;
    const tracks = detail.tracks.map((t) => (t.position === position ? { ...t, mark: next } : t));
    this.details = new Map(this.details).set(releaseId, { ...detail, tracks });
    const client = api.pinned();
    void this.#write(async () => {
      try {
        await client.postTrackVerdict({ releaseId, position, mark: next });
      } catch (e) {
        this.#flash(`The track mark was not saved: ${errorMessage(e)}`);
      }
    });
  }

  retryDetail(id: number): void {
    const errors = new Map(this.detailErrors);
    errors.delete(id);
    this.detailErrors = errors;
    void this.#loadDetail(id);
  }

  showFlash(message: string): void {
    this.#flash(message);
  }

  async #pushToWantlist(entry: HistoryEntry, slipId: number, client: Api): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, PUSH_GRACE_MS));
    if (!this.history.includes(entry)) return;
    const { item } = entry;
    let push: "done" | "failed" = "done";
    try {
      await client.pushToWantlist(item.id);
      if (!this.history.includes(entry)) {
        // Undone while the request ran.
        void this.#removeFromWantlist(item.id, client);
        return;
      }
      this.#pushed.set(item.triageKey, item.id);
    } catch (e) {
      push = "failed";
      this.#flash(
        `Not added to the Discogs wantlist: ${errorMessage(e)}. A in Twelves tries again.`,
      );
    }
    const slip = this.slip;
    if (slip?.kind === "verdict" && slip.id === slipId) this.slip = { ...slip, push };
  }

  async #removeFromWantlist(releaseId: number, client: Api): Promise<void> {
    try {
      await client.removeFromWantlist(releaseId);
      this.#flash(
        client.mode === "sandbox"
          ? "Taken off your wantlist again (sandbox: nothing sent)."
          : "Taken off your Discogs wantlist again.",
      );
    } catch (e) {
      this.#flash(`Still on your Discogs wantlist: ${errorMessage(e)}`);
    }
  }

  /** Drops what belongs to the other api mode: undo history, passes, pushes and details. */
  #forget(): void {
    this.#apiGeneration = api.generation;
    this.history = [];
    this.passed = [];
    this.slip = null;
    this.details = new Map();
    this.detailErrors = new Map();
    this.#pushed.clear();
    this.#roundVerdicts.clear();
  }

  /** Writes run one at a time, in order, so an undo never overtakes its verdict. */
  #write(fn: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(fn);
    this.#writes = run.catch(() => {});
    return run;
  }

  #bumpStats(status: TriageStatus, previous: Verdict | null, delta: number): void {
    const s = stats.value;
    if (!s) return;
    const verdicts = { ...s.verdicts, [status]: s.verdicts[status] + delta };
    if (previous) {
      // A record heard again was already dug; only its status moves.
      verdicts[previous.status] -= delta;
      stats.value = { ...s, verdicts };
      return;
    }
    stats.value = {
      ...s,
      dug: Math.max(0, s.dug + delta),
      remaining: Math.max(0, s.remaining - delta),
      verdicts,
    };
  }

  #afterMove(): void {
    if (this.round && this.upcoming.length === 0) {
      this.endRound();
      this.#flash("That was every snoozed record in the round; back to the queue.");
      return;
    }
    this.#prefetch();
    if (!this.exhausted && this.upcoming.length < REFILL_BELOW) {
      this.#refill().catch((e: unknown) => {
        const message = `Could not fetch more of the queue: ${errorMessage(e)}`;
        this.#flash(message);
        // With nothing buffered, the page needs the error state so Enter can retry.
        if (this.upcoming.length === 0) {
          this.status = "error";
          this.error = message;
        }
      });
    }
    this.#prune();
  }

  #refill(): Promise<void> {
    if (this.#refilling) return this.#refilling;
    const generation = this.#generation;
    const run = (async () => {
      const known = new Set(
        [...this.upcoming, ...this.passed, ...this.history.map((h) => h.item)].map(
          (i) => i.triageKey,
        ),
      );
      const res = await api.getQueue({
        limit: Math.min(MAX_QUEUE_LIMIT, this.#batch + this.upcoming.length + this.passed.length),
      });
      // A round took over meanwhile; the queue refills again when it ends.
      if (generation !== this.#generation || this.round) return;
      const fresh = res.items.filter((i) => !known.has(i.triageKey));
      if (fresh.length === 0) this.exhausted = true;
      this.upcoming = [...this.upcoming, ...fresh];
      this.#prefetch();
    })();
    const tracked: Promise<void> = run.finally(() => {
      if (this.#refilling === tracked) this.#refilling = null;
    });
    this.#refilling = tracked;
    return tracked;
  }

  #prefetch(): void {
    for (const item of this.upcoming.slice(0, PREFETCH)) {
      if (this.details.has(item.id) || this.#loading.has(item.id) || this.detailErrors.has(item.id))
        continue;
      void this.#loadDetail(item.id);
    }
  }

  async #loadDetail(id: number): Promise<void> {
    this.#loading.add(id);
    try {
      const detail = await api.getRelease(id);
      this.details = new Map(this.details).set(id, detail);
    } catch (e) {
      this.detailErrors = new Map(this.detailErrors).set(id, errorMessage(e));
    } finally {
      this.#loading.delete(id);
    }
  }

  /** Keeps details for the releases ahead and the recent history (undo returns to them). */
  #prune(): void {
    if (this.details.size < 60) return;
    const keep = new Set([
      ...this.upcoming.slice(0, PREFETCH).map((i) => i.id),
      ...this.history.slice(-20).map((h) => h.item.id),
    ]);
    this.details = new Map([...this.details].filter(([id]) => keep.has(id)));
  }

  #flash(message: string): void {
    this.flash = message;
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.flash = null;
    }, 6000);
  }
}
