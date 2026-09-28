import type { QueueItem, ReleaseDetail, TwelvesItem } from "../../shared/api.ts";
import type { TrackMark, Verdict } from "../../shared/types.ts";
import { type Api, type AppApi, api as appApi } from "../api.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

type VerdictEntry = {
  kind: "verdict";
  item: QueueItem;
  status: TriageStatus;
  /** The verdict this one replaced (a snoozed record heard again); undo restores it. */
  previous: Verdict | null;
};

type HistoryEntry = VerdictEntry | { kind: "pass"; item: QueueItem };

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
export interface SessionOptions {
  /** A want waits this long before the wantlist push, so a quick Z cancels it instead. */
  pushGraceMs?: number;
}

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

  #api: AppApi;
  #pushGraceMs: number;
  #batch = 200;
  #loading = new Set<number>();
  #refilling: Promise<void> | null = null;
  /** Bumped by start(); a refill from an older generation drops its result. */
  #generation = 0;
  /** The api mode the history and details belong to; see AppApi.generation. */
  #apiGeneration: number;
  /** Release ids by triage key that this session put on the Discogs wantlist. */
  #onWantlist = new Map<string, number>();
  #wantlistWrites: Promise<unknown> = Promise.resolve();
  /** The queue as it was when a round started. */
  #queueBeforeRound: { upcoming: QueueItem[]; passed: QueueItem[]; exhausted: boolean } | null =
    null;
  /** Verdicts of the records taken into rounds, by triage key. */
  #roundVerdicts = new Map<string, Verdict>();
  #writes: Promise<unknown> = Promise.resolve();
  #slipSeq = 0;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(api: AppApi = appApi, opts: SessionOptions = {}) {
    this.#api = api;
    this.#apiGeneration = api.generation;
    this.#pushGraceMs = opts.pushGraceMs ?? 1500;
  }

  async start(batch: number): Promise<void> {
    // Undo and the details' overlays belong to the mode they were made in.
    if (this.#api.generation !== this.#apiGeneration) this.#forget();
    // Passes made before a round still belong to the queue.
    if (this.#queueBeforeRound) this.passed = this.#queueBeforeRound.passed;
    this.#batch = batch;
    const generation = ++this.#generation;
    this.#refilling = null;
    this.status = "loading";
    this.error = null;
    this.upcoming = [];
    this.exhausted = false;
    this.round = null;
    this.#queueBeforeRound = null;
    try {
      await this.#refill();
      if (generation !== this.#generation) return;
      this.status = "ready";
    } catch (error) {
      if (generation !== this.#generation) return;
      this.status = "error";
      this.error = errorMessage(error);
    }
  }

  judge(status: TriageStatus): void {
    const item = this.current;
    if (!item) return;
    const client = this.#api.pinned();
    const previous = this.#roundVerdicts.get(item.triageKey) ?? null;
    const entry: VerdictEntry = { kind: "verdict", item, status, previous };
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
    const generation = this.#apiGeneration;
    void this.#write(() => this.#saveVerdict(entry, { client, generation, slipId: id }));
  }

  async #saveVerdict(
    entry: VerdictEntry,
    operation: { client: Api; generation: number; slipId: number },
  ): Promise<void> {
    const { item, status, previous } = entry;
    const { client, generation, slipId } = operation;
    try {
      await client.postVerdict({
        key: item.triageKey,
        status,
        releaseId: item.id,
        notes: previous?.notes ?? null,
      });
    } catch (error) {
      if (generation !== this.#apiGeneration) return;
      this.#recoverVerdict(entry, error);
      return;
    }
    if (generation !== this.#apiGeneration) return;
    stats.refreshSoon();
    // Discogs writes have their own chain so they cannot delay verdicts.
    if (status === "accepted") void this.#pushAfterGrace(entry, slipId, client);
  }

  #recoverVerdict(entry: VerdictEntry, error: unknown): void {
    this.#flash(`The verdict was not saved: ${errorMessage(error)}`);
    stats.refreshSoon(0);
    if (!this.history.includes(entry)) return;
    this.history = this.history.filter((item) => item !== entry);
    this.#returnToQueue(entry.item);
    stats.session -= 1;
    this.slip = null;
  }

  #returnToQueue(item: QueueItem): void {
    this.upcoming = [item, ...this.upcoming.filter((next) => next.triageKey !== item.triageKey)];
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
    for (const record of records) this.#roundVerdicts.set(record.verdict.key, record.verdict);
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
    // Queue releases that undo brought back during the round stay in front.
    const returned = this.upcoming.filter((i) => !this.#roundVerdicts.has(i.triageKey));
    const returnedKeys = new Set(returned.map((i) => i.triageKey));
    this.upcoming = [
      ...returned,
      ...saved.upcoming.filter((i) => !judged.has(i.triageKey) && !returnedKeys.has(i.triageKey)),
    ];
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
    if (entry.kind === "pass") {
      const keep = (i: QueueItem) => i.triageKey !== item.triageKey;
      this.passed = this.passed.filter(keep);
      const saved = this.#queueBeforeRound;
      if (saved) this.#queueBeforeRound = { ...saved, passed: saved.passed.filter(keep) };
    }
    this.#returnToQueue(item);
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
    const client = this.#api.pinned();
    const generation = this.#apiGeneration;
    void this.#write(() => this.#saveUndo(entry, client, generation));
  }

  async #saveUndo(entry: VerdictEntry, client: Api, generation: number): Promise<void> {
    try {
      if (entry.previous) await client.postVerdict(entry.previous);
      else await client.deleteVerdict(entry.item.triageKey);
    } catch (error) {
      if (generation !== this.#apiGeneration) return;
      this.#recoverUndo(entry, error);
      return;
    }
    if (generation !== this.#apiGeneration) return;
    if (entry.status === "accepted") void this.#takeOffWantlist(entry.item, client);
    stats.refreshSoon();
  }

  #recoverUndo(entry: VerdictEntry, error: unknown): void {
    this.#flash(`Undo failed: ${errorMessage(error)}`);
    const key = entry.item.triageKey;
    // A later action on this record owns its optimistic state.
    if (!this.history.some((later) => later.item.triageKey === key)) {
      this.history = [...this.history, entry];
      this.upcoming = this.upcoming.filter((item) => item.triageKey !== key);
      stats.session += 1;
      this.slip = null;
    }
    stats.refreshSoon(0);
  }

  /** Toggles a mark on a track; the same mark again clears it. */
  markTrack(releaseId: number, position: string, mark: TrackMark): void {
    const detail = this.details.get(releaseId);
    const track = detail?.tracks.find((t) => t.position === position);
    if (!detail || !track) return;
    const next = track.mark === mark ? null : mark;
    const tracks = detail.tracks.map((t) => (t.position === position ? { ...t, mark: next } : t));
    this.details = new Map(this.details).set(releaseId, { ...detail, tracks });
    const client = this.#api.pinned();
    const generation = this.#apiGeneration;
    const optimistic = this.details.get(releaseId);
    void this.#write(async () => {
      try {
        await client.postTrackVerdict({ releaseId, position, mark: next });
      } catch (error) {
        if (generation !== this.#apiGeneration) return;
        if (this.details.get(releaseId) === optimistic) {
          this.details = new Map(this.details).set(releaseId, detail);
        }
        this.#flash(`The track mark was not saved: ${errorMessage(error)}`);
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

  async #pushAfterGrace(entry: HistoryEntry, slipId: number, client: Api): Promise<void> {
    const generation = this.#apiGeneration;
    await new Promise((resolve) => setTimeout(resolve, this.#pushGraceMs));
    if (generation !== this.#apiGeneration) return;
    if (!this.history.includes(entry)) return;
    let push: "done" | "failed" | null;
    try {
      await this.#syncWantlist(entry.item, client);
      push = this.#onWantlist.has(entry.item.triageKey) ? "done" : null;
    } catch (error) {
      if (generation !== this.#apiGeneration) return;
      push = "failed";
      this.#flash(
        `Not added to the Discogs wantlist: ${errorMessage(error)}. A in Twelves tries again.`,
      );
    }
    if (generation !== this.#apiGeneration) return;
    const slip = this.slip;
    if (slip?.kind === "verdict" && slip.id === slipId) this.slip = { ...slip, push };
  }

  async #takeOffWantlist(item: QueueItem, client: Api): Promise<void> {
    const generation = this.#apiGeneration;
    try {
      if ((await this.#syncWantlist(item, client)) !== "removed") return;
      if (generation !== this.#apiGeneration) return;
      this.#flash(
        client.mode === "sandbox"
          ? "Taken off your wantlist again (sandbox: nothing sent)."
          : "Taken off your Discogs wantlist again.",
      );
    } catch (error) {
      if (generation !== this.#apiGeneration) return;
      this.#flash(`Still on your Discogs wantlist: ${errorMessage(error)}`);
    }
  }

  /** The newest verdict in the history for the key is a want. */
  #wanted(key: string): boolean {
    for (const entry of this.history.toReversed()) {
      if (entry.kind === "verdict" && entry.item.triageKey === key)
        return entry.status === "accepted";
    }
    return false;
  }

  /**
   * Brings the Discogs wantlist in line with the history for one record. The calls run one at a
   * time and decide when they run, not when they were asked for, so any mix of A, Z and slow
   * requests ends with the release on the wantlist exactly when its latest verdict is a want.
   */
  #syncWantlist(item: QueueItem, client: Api): Promise<"added" | "removed" | null> {
    const generation = this.#apiGeneration;
    const current = () => generation === this.#apiGeneration;
    const run = this.#wantlistWrites.then(async (): Promise<"added" | "removed" | null> => {
      const key = item.triageKey;
      const pushedId = this.#onWantlist.get(key);
      if (!current()) return null;
      if (this.#wanted(key) && pushedId === undefined) {
        // Twelves may have changed the verdict during the grace period.
        const saved = await client.getRelease(item.id);
        if (saved.verdict?.status !== "accepted" || !this.#wanted(key) || !current()) return null;
        await client.pushToWantlist(item.id);
        if (current()) this.#onWantlist.set(key, item.id);
        return "added";
      }
      if (!this.#wanted(key) && pushedId !== undefined) {
        await client.removeFromWantlist(pushedId);
        if (current()) this.#onWantlist.delete(key);
        return "removed";
      }
      return null;
    });
    this.#wantlistWrites = run.catch(() => {});
    return run;
  }

  /** Drops what belongs to the other api mode: undo history, passes, pushes and details. */
  #forget(): void {
    this.#apiGeneration = this.#api.generation;
    this.history = [];
    this.passed = [];
    this.slip = null;
    this.details = new Map();
    this.detailErrors = new Map();
    this.#loading = new Set();
    this.flash = null;
    this.#onWantlist.clear();
    this.#roundVerdicts.clear();
    this.round = null;
    this.#queueBeforeRound = null;
  }

  /** Writes run one at a time, in order, so an undo never overtakes its verdict. */
  #write(fn: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(fn);
    this.#writes = run.catch(() => {});
    return run;
  }

  #bumpStats(status: TriageStatus, previous: Verdict | null, delta: number): void {
    const current = stats.value;
    if (!current) return;
    const verdicts = { ...current.verdicts, [status]: current.verdicts[status] + delta };
    if (previous) {
      // A record heard again was already dug; only its status moves.
      verdicts[previous.status] -= delta;
      stats.value = { ...current, verdicts };
      return;
    }
    stats.value = {
      ...current,
      dug: Math.max(0, current.dug + delta),
      remaining: Math.max(0, current.remaining - delta),
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
      const generation = this.#generation;
      this.#refill().catch((error: unknown) => {
        if (generation !== this.#generation) return;
        const message = `Could not fetch more of the queue: ${errorMessage(error)}`;
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
      const res = await this.#api.getQueue({
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
    const loading = this.#loading;
    loading.add(id);
    const generation = this.#apiGeneration;
    try {
      const detail = await this.#api.getRelease(id);
      // Fetched in the other mode: its marks and heard flags would be wrong here.
      if (generation !== this.#apiGeneration) return;
      this.details = new Map(this.details).set(id, detail);
    } catch (error) {
      if (generation !== this.#apiGeneration) return;
      this.detailErrors = new Map(this.detailErrors).set(id, errorMessage(error));
    } finally {
      loading.delete(id);
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
