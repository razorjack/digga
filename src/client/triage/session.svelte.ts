import type { QueueItem, ReleaseDetail } from "../../shared/api.ts";
import type { TrackMark } from "../../shared/types.ts";
import { api } from "../api.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

type HistoryEntry =
  | { kind: "verdict"; item: QueueItem; status: TriageStatus }
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
  | { kind: "pass"; item: QueueItem; id: number }
  | { kind: "undo"; item: QueueItem; undone: TriageStatus | "pass"; id: number };

/** Fetch more of the queue when fewer releases than this are buffered. */
const REFILL_BELOW = 8;
/** Release details fetched ahead of the cursor (the next one also feeds the preloading deck). */
const PREFETCH = 3;
const MAX_QUEUE_LIMIT = 5000;

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

  current = $derived(this.upcoming[0] ?? null);
  next = $derived(this.upcoming[1] ?? null);
  currentDetail = $derived(this.current ? (this.details.get(this.current.id) ?? null) : null);
  nextDetail = $derived(this.next ? (this.details.get(this.next.id) ?? null) : null);
  finished = $derived(this.status === "ready" && this.upcoming.length === 0 && this.exhausted);

  #batch = 200;
  #loading = new Set<number>();
  #refilling: Promise<void> | null = null;
  #writes: Promise<unknown> = Promise.resolve();
  #slipSeq = 0;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  async start(batch: number): Promise<void> {
    this.#batch = batch;
    this.status = "loading";
    this.error = null;
    this.upcoming = [];
    this.exhausted = false;
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
    const entry: HistoryEntry = { kind: "verdict", item, status };
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
    this.#bumpStats(status, 1);
    this.#afterMove();
    void this.#write(async () => {
      try {
        await api.postVerdict({ key: item.triageKey, status, releaseId: item.id });
      } catch (e) {
        this.history = this.history.filter((h) => h !== entry);
        this.upcoming = [item, ...this.upcoming.filter((i) => i.triageKey !== item.triageKey)];
        stats.session -= 1;
        this.slip = null;
        this.#flash(`The verdict was not saved: ${errorMessage(e)}`);
        stats.refreshSoon(0);
        return;
      }
      stats.refreshSoon();
      if (status !== "accepted") return;
      let push: "done" | "failed" = "done";
      try {
        await api.pushToWantlist(item.id);
      } catch (e) {
        push = "failed";
        this.#flash(`Not added to the Discogs wantlist: ${errorMessage(e)}`);
      }
      const slip = this.slip;
      if (slip?.kind === "verdict" && slip.id === id) this.slip = { ...slip, push };
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
    this.slip = { kind: "pass", item, id: ++this.#slipSeq };
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
    this.#bumpStats(entry.status, -1);
    void this.#write(async () => {
      try {
        await api.deleteVerdict(item.triageKey);
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
    void this.#write(async () => {
      try {
        await api.postTrackVerdict({ releaseId, position, mark: next });
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

  /** Writes run one at a time, in order, so an undo never overtakes its verdict. */
  #write(fn: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(fn);
    this.#writes = run.catch(() => {});
    return run;
  }

  #bumpStats(status: TriageStatus, delta: number): void {
    const s = stats.value;
    if (!s) return;
    stats.value = {
      ...s,
      remaining: Math.max(0, s.remaining - delta),
      verdicts: { ...s.verdicts, [status]: s.verdicts[status] + delta },
    };
  }

  #afterMove(): void {
    this.#prefetch();
    if (!this.exhausted && this.upcoming.length < REFILL_BELOW) {
      this.#refill().catch((e: unknown) => {
        this.#flash(`Could not fetch more of the queue: ${errorMessage(e)}`);
      });
    }
    this.#prune();
  }

  #refill(): Promise<void> {
    this.#refilling ??= (async () => {
      const known = new Set(
        [...this.upcoming, ...this.passed, ...this.history.map((h) => h.item)].map(
          (i) => i.triageKey,
        ),
      );
      const res = await api.getQueue({
        limit: Math.min(MAX_QUEUE_LIMIT, this.#batch + this.upcoming.length + this.passed.length),
      });
      const fresh = res.items.filter((i) => !known.has(i.triageKey));
      if (fresh.length === 0) this.exhausted = true;
      this.upcoming = [...this.upcoming, ...fresh];
      this.#prefetch();
    })().finally(() => {
      this.#refilling = null;
    });
    return this.#refilling;
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
