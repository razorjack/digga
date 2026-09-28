import type { QueueItem, ReleaseDetail, TwelvesItem, TrackVerdictInput } from "../../shared/api.ts";
import type { ReleaseSnapshot, TrackMark, Verdict } from "../../shared/types.ts";
import { type Api, type AppApi, api as appApi } from "../api.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage, stats } from "../stores.svelte.ts";
import { EnrichAhead } from "./enrich-ahead.ts";

type VerdictEntry = {
  kind: "verdict";
  item: QueueItem;
  status: TriageStatus;
  /** The note saved with the verdict. */
  notes: string | null;
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

export interface StartOptions {
  /** Records after the current one to enrich from Discogs while they wait; 0 turns it off. */
  enrichAhead?: number;
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
  /** Notes written in Triage, by triage key; a record's verdict saves its note. */
  notes = $state.raw<ReadonlyMap<string, string | null>>(new Map());

  current = $derived(this.upcoming[0] ?? null);
  next = $derived(this.upcoming[1] ?? null);
  currentDetail = $derived(this.current ? (this.details.get(this.current.id) ?? null) : null);
  nextDetail = $derived(this.next ? (this.details.get(this.next.id) ?? null) : null);
  finished = $derived(this.status === "ready" && this.upcoming.length === 0 && this.exhausted);

  #api: AppApi;
  #pushGraceMs: number;
  #batch = 200;
  #enrichAheadCount = 0;
  #enrichAhead: EnrichAhead;
  #loading = new Set<number>();
  #trackWrites = new Map<string, { saved: TrackMark | null; version: number }>();
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
  #graceTimers = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(api: AppApi = appApi, opts: SessionOptions = {}) {
    this.#api = api;
    this.#apiGeneration = api.generation;
    this.#pushGraceMs = opts.pushGraceMs ?? 1500;
    this.#enrichAhead = this.#createEnrichAhead();
  }

  destroy(): void {
    this.#generation += 1;
    this.#apiGeneration = -1;
    this.#enrichAhead.stop();
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    for (const [timer, resolve] of this.#graceTimers) {
      clearTimeout(timer);
      resolve();
    }
    this.#graceTimers.clear();
  }

  async start(batch: number, options: StartOptions = {}): Promise<void> {
    // Undo and the details' overlays belong to the mode they were made in.
    if (this.#api.generation !== this.#apiGeneration) this.#forget();
    // Passes made before a round still belong to the queue.
    if (this.#queueBeforeRound) this.passed = this.#queueBeforeRound.passed;
    this.#batch = batch;
    this.#enrichAheadCount = options.enrichAhead ?? 0;
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
    const notes = this.noteFor(item);
    const entry: VerdictEntry = { kind: "verdict", item, status, notes, previous };
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
    const { item, status, notes } = entry;
    const { client, generation, slipId } = operation;
    try {
      await client.postVerdict({ key: item.triageKey, status, releaseId: item.id, notes });
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

  /** The record's note: written in this session, else the one its snoozed verdict has. */
  noteFor(item: QueueItem): string | null {
    if (this.notes.has(item.triageKey)) return this.notes.get(item.triageKey) ?? null;
    return this.#roundVerdicts.get(item.triageKey)?.notes ?? null;
  }

  /** Keeps a note for the record until its verdict saves it; an empty note removes it. */
  setNote(item: QueueItem, text: string): void {
    const note = text.trim() === "" ? null : text.trim();
    this.notes = new Map(this.notes).set(item.triageKey, note);
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
    const key = `${releaseId}:${position}`;
    const state = this.#trackWrites.get(key) ?? { saved: track.mark, version: 0 };
    const version = ++state.version;
    this.#trackWrites.set(key, state);
    this.#setTrackMark(releaseId, position, next);
    const client = this.#api.pinned();
    const generation = this.#apiGeneration;
    void this.#write(() =>
      this.#saveTrackMark({ releaseId, position, mark: next }, client, {
        key,
        version,
        generation,
      }),
    );
  }

  #setTrackMark(releaseId: number, position: string, mark: TrackMark | null): void {
    const detail = this.details.get(releaseId);
    if (!detail) return;
    const tracks = detail.tracks.map((track) =>
      track.position === position ? { ...track, mark } : track,
    );
    this.details = new Map(this.details).set(releaseId, { ...detail, tracks });
  }

  async #saveTrackMark(
    input: TrackVerdictInput,
    client: Api,
    operation: { key: string; version: number; generation: number },
  ): Promise<void> {
    try {
      await client.postTrackVerdict(input);
      if (operation.generation !== this.#apiGeneration) return;
      const state = this.#trackWrites.get(operation.key);
      if (state) state.saved = input.mark;
    } catch (error) {
      if (operation.generation !== this.#apiGeneration) return;
      const state = this.#trackWrites.get(operation.key);
      // Later queued marks own their optimistic value until their own write settles.
      if (state?.version === operation.version) {
        this.#setTrackMark(input.releaseId, input.position, state.saved);
      }
      this.#flash(`The track mark was not saved: ${errorMessage(error)}`);
    }
  }

  /** Attaches a YouTube link to the record on screen; the player picks the video up. */
  async attachVideo(url: string): Promise<void> {
    const item = this.current;
    if (!item) return;
    const generation = this.#apiGeneration;
    try {
      const detail = await this.#api.pinned().attachVideo(item.id, url);
      if (generation !== this.#apiGeneration) return;
      this.details = new Map(this.details).set(item.id, detail);
      this.#flash("Attached to this release; it plays here from now on.");
    } catch (error) {
      if (generation === this.#apiGeneration)
        this.#flash(`The link was not attached: ${errorMessage(error)}`);
    }
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

  #waitForPushGrace(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#graceTimers.delete(timer);
        resolve();
      }, this.#pushGraceMs);
      this.#graceTimers.set(timer, resolve);
    });
  }

  async #pushAfterGrace(entry: HistoryEntry, slipId: number, client: Api): Promise<void> {
    const generation = this.#apiGeneration;
    await this.#waitForPushGrace();
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
    this.#trackWrites.clear();
    this.flash = null;
    this.#onWantlist.clear();
    this.#roundVerdicts.clear();
    this.notes = new Map();
    this.round = null;
    this.#queueBeforeRound = null;
    this.#enrichAhead.stop();
    this.#enrichAhead = this.#createEnrichAhead();
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
    this.#prepareAhead();
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
      this.#prepareAhead();
    })();
    const tracked: Promise<void> = run.finally(() => {
      if (this.#refilling === tracked) this.#refilling = null;
    });
    this.#refilling = tracked;
    return tracked;
  }

  /** Fetches the details of the records coming up and enriches those without market data. */
  #prepareAhead(): void {
    this.#prefetch();
    if (this.#enrichAheadCount > 0)
      this.#enrichAhead.request(this.upcoming.slice(0, 1 + this.#enrichAheadCount));
  }

  #createEnrichAhead(): EnrichAhead {
    return new EnrichAhead({
      enrich: async (releaseId) => {
        const generation = this.#apiGeneration;
        const detail = await this.#api.pinned().enrichRelease(releaseId);
        return generation === this.#apiGeneration ? detail : null;
      },
      apply: (detail) => this.#applyEnrichment(detail),
    });
  }

  /** Shows a record's fresh market data; its fresh videos too, unless it is playing already. */
  #applyEnrichment(detail: ReleaseDetail): void {
    const id = detail.release.id;
    const snapshot = detail.release.snapshot;
    this.upcoming = this.upcoming.map((item) =>
      item.id === id ? withMarketData(item, snapshot) : item,
    );
    if (this.current?.id === id || !this.details.has(id)) return;
    this.details = new Map(this.details).set(id, detail);
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

function withMarketData(item: QueueItem, snapshot: ReleaseSnapshot): QueueItem {
  return {
    ...item,
    lowestPrice: snapshot.lowestPrice,
    numForSale: snapshot.numForSale,
    currency: snapshot.currency,
    communityHave: snapshot.communityHave,
    communityWant: snapshot.communityWant,
    enrichedAt: snapshot.enrichedAt,
  };
}
