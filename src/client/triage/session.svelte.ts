import type { QueueItem, ReleaseDetail, TwelvesItem, TrackVerdictInput } from "../../shared/api.ts";
import type { QueueScope } from "../../shared/scope.ts";
import type { ReleaseSnapshot, TrackMark, Verdict } from "../../shared/types.ts";
import { isWantlistVerdict, PUSH_RETRY_DELAYS_MS } from "../../shared/wantlist.ts";
import { type Api, ApiRequestError, type AppApi, api as appApi } from "../api.ts";
import type { TriageStatus } from "../keymap.ts";
import { errorMessage, stats } from "../stores.svelte.ts";

type VerdictEntry = {
  kind: "verdict";
  item: QueueItem;
  status: TriageStatus;
  /** The note saved with the verdict. */
  notes: string | null;
  /** The verdict this one replaced (a snoozed record heard again); undo restores it. */
  previous: Verdict | null;
};

/** X hid the label of the record on screen; undo lets it back into the queue. */
type LabelEntry = { kind: "label"; item: QueueItem; label: string };

type HistoryEntry = VerdictEntry | { kind: "pass"; item: QueueItem } | LabelEntry;

/** How far a want's push to the Discogs wantlist has got. */
export type PushState = "pending" | "retrying" | "done" | "failed";

/** What the slip under the player shows: the last thing that happened to a release. */
export type Slip =
  | {
      kind: "verdict";
      item: QueueItem;
      status: TriageStatus;
      id: number;
      push: PushState | null;
      /** While a failed push waits to be tried again: how long the wait is. */
      retryInMs?: number;
    }
  | { kind: "pass"; item: QueueItem; id: number; stays: "queue" | "snoozed" }
  | { kind: "label"; item: QueueItem; label: string; id: number }
  | { kind: "undo"; item: QueueItem; undone: TriageStatus | "pass" | "label"; id: number };

/** Snoozed records heard again, ahead of the queue, which resumes where it was afterwards. */
export interface Round {
  total: number;
}

/**
 * An answer from the queue, and the records it may be wrong about: those with a verdict or undo
 * unanswered when it was asked for, or written since.
 */
interface QueueRead {
  items: QueueItem[];
  /** The server has nothing beyond these. */
  complete: boolean;
  unsettled: Set<string>;
}

/** Fetch more of the queue when fewer releases than this are buffered. */
const REFILL_BELOW = 8;
/** Release details fetched ahead of the cursor (the next one also feeds the preloading deck). */
const PREFETCH = 3;
const MAX_QUEUE_LIMIT = 5000;
export interface SessionOptions {
  /** The waits before each new try of a failed push; PUSH_RETRY_DELAYS_MS unless a test sets them. */
  pushRetryDelaysMs?: number[];
  /** Leaves a label out of the queue filters, or lets it back in; saving restarts the queue. */
  setLabelHidden?: (label: string, hidden: boolean) => Promise<void>;
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
  /** The slip whose verdict or undo is still being written. */
  #savingSlip = $state<number | null>(null);
  flash = $state<string | null>(null);
  round = $state.raw<Round | null>(null);
  /** The label, artist or seller the queue is narrowed to; null digs everything the filters let in. */
  scope = $state.raw<QueueScope | null>(null);
  /** Notes written in Triage, by triage key; a record's verdict saves its note. */
  notes = $state.raw<ReadonlyMap<string, string | null>>(new Map());
  /** Releases whose market data P asked Discogs for, until the answer comes. */
  pricing = $state.raw<ReadonlySet<number>>(new Set());

  current = $derived(this.upcoming[0] ?? null);
  next = $derived(this.upcoming[1] ?? null);
  currentDetail = $derived(this.current ? (this.details.get(this.current.id) ?? null) : null);
  nextDetail = $derived(this.next ? (this.details.get(this.next.id) ?? null) : null);
  finished = $derived(this.status === "ready" && this.upcoming.length === 0 && this.exhausted);

  #api: AppApi;
  #pushRetryDelaysMs: number[];
  #setLabelHidden: SessionOptions["setLabelHidden"];
  #batch = 200;
  /** Market data fetched this session, by release id, for records that moved on before it came. */
  #marketData = new Map<number, ReleaseSnapshot>();
  #loading = new Set<number>();
  #noteVersions = new Map<string, number>();
  noteStatus = $state<string | null>(null);
  #trackWrites = new Map<string, { saved: TrackMark | null; version: number }>();
  /** The queue read in flight, a refill or a read after the page is shown again. */
  #reading: Promise<void> | null = null;
  /** Verdicts and undos the server has not answered yet, counted by triage key. */
  #unanswered = new Map<string, number>();
  /** For each queue read in flight, the keys written since it was sent. */
  #openReads = new Set<Set<string>>();
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
  #retryTimers = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(api: AppApi = appApi, opts: SessionOptions = {}) {
    this.#api = api;
    this.#apiGeneration = api.generation;
    this.#pushRetryDelaysMs = opts.pushRetryDelaysMs ?? PUSH_RETRY_DELAYS_MS;
    this.#setLabelHidden = opts.setLabelHidden;
  }

  destroy(): void {
    stats.setScope(null);
    this.#generation += 1;
    this.#apiGeneration = -1;
    if (this.#flashTimer) clearTimeout(this.#flashTimer);
    for (const [timer, resolve] of this.#retryTimers) {
      clearTimeout(timer);
      resolve();
    }
    this.#retryTimers.clear();
  }

  async start(batch: number): Promise<void> {
    // Undo and the details' overlays belong to the mode they were made in.
    if (this.#api.generation !== this.#apiGeneration) this.#forget();
    // Passes made before a round still belong to the queue.
    if (this.#queueBeforeRound) this.passed = this.#queueBeforeRound.passed;
    this.#batch = batch;
    const generation = ++this.#generation;
    this.#reading = null;
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

  /**
   * While a load adds records, the end of the queue is only the end of what has arrived: asks the
   * server again, and the next record shows once there is one.
   */
  async lookAgain(): Promise<void> {
    if (!this.finished || this.round) return;
    const generation = this.#generation;
    try {
      await this.#refill();
    } catch (error) {
      if (generation === this.#generation)
        this.#flash(`Could not look for new records: ${errorMessage(error)}`);
    }
  }

  /**
   * The page is shown again, and Twelves may have sent records back to the queue meanwhile. The
   * record on screen stays; the records after it follow the queue's order again.
   */
  async readAgain(): Promise<void> {
    if (this.status !== "ready" || this.round) return;
    const generation = this.#generation;
    const inFlight = this.#reading;
    try {
      await this.#claimRead(async () => {
        if (inFlight) await inFlight.catch(() => {});
        await this.#rebuildAfterCurrent();
      });
    } catch (error) {
      if (generation === this.#generation)
        this.#flash(`Could not read the queue again: ${errorMessage(error)}`);
    }
  }

  /**
   * Narrows the queue to one label's, artist's or seller's records, or with null lets everything back.
   * Passes belong to the queue they were made in; the server returns them in the new one.
   */
  async setScope(scope: QueueScope | null): Promise<void> {
    this.scope = scope;
    stats.setScope(scope);
    this.passed = [];
    this.#queueBeforeRound = null;
    await this.start(this.#batch);
    // After the queue, so the sandbox knows which of its verdicts the scope holds.
    void stats.refresh();
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
      push: isWantlistVerdict(status) ? "pending" : null,
    };
    this.#savingSlip = id;
    stats.session += 1;
    this.#bumpStats(status, previous, 1);
    this.#afterMove();
    const generation = this.#apiGeneration;
    const answered = this.#startWrite(item.triageKey);
    void this.#write(() =>
      this.#saveVerdict(entry, { client, generation, slipId: id }).finally(answered),
    );
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
      this.#settleSlip(slipId);
      if (generation !== this.#apiGeneration) return;
      this.#recoverVerdict(entry, error);
      return;
    }
    if (generation === this.#apiGeneration) {
      stats.refreshSoon();
      // Discogs writes have their own chain so they cannot delay verdicts.
      if (isWantlistVerdict(status)) void this.#pushWant(entry, slipId, client);
    }
    // Last, so a settled slip means its push has started.
    this.#settleSlip(slipId);
  }

  #settleSlip(slipId: number): void {
    if (this.#savingSlip === slipId) this.#savingSlip = null;
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
    const snapshot = this.#marketData.get(item.id);
    const returned = snapshot ? withMarketData(item, snapshot) : item;
    this.upcoming = [
      returned,
      ...this.upcoming.filter((next) => next.triageKey !== item.triageKey),
    ];
  }

  /** The slip reports a write the server has not answered yet, or the page has not acted on. */
  get slipBusy(): boolean {
    return this.slip !== null && this.#savingSlip === this.slip.id;
  }

  /** The record's note: written in this session, else the one its snoozed verdict has. */
  noteFor(item: QueueItem): string | null {
    if (this.notes.has(item.triageKey)) return this.notes.get(item.triageKey) ?? null;
    const detail = this.details.get(item.id);
    if (detail?.note !== undefined) return detail.note;
    return this.#roundVerdicts.get(item.triageKey)?.notes ?? null;
  }

  /** Saves a note without making or changing a judgement. */
  setNote(item: QueueItem, text: string): void {
    const previous = this.noteFor(item);
    const note = text.trim() === "" ? null : text.trim();
    const key = item.triageKey;
    const version = (this.#noteVersions.get(key) ?? 0) + 1;
    this.#noteVersions.set(key, version);
    this.notes = new Map(this.notes).set(key, note);
    this.noteStatus = "Saving note…";
    const client = this.#api.pinned();
    const generation = this.#apiGeneration;
    void this.#write(async () => {
      try {
        await client.putReleaseNote(item.id, note);
        if (generation === this.#apiGeneration && this.#noteVersions.get(key) === version)
          this.noteStatus = client.mode === "sandbox" ? "Note kept in sandbox." : "Note saved.";
      } catch (error) {
        if (generation !== this.#apiGeneration || this.#noteVersions.get(key) !== version) return;
        this.notes = new Map(this.notes).set(key, previous);
        this.noteStatus = `Note not saved: ${errorMessage(error)}`;
      }
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

  /** X: leaves every record on the current record's label out of the queue; Z lets them back. */
  async hideLabel(): Promise<void> {
    const item = this.current;
    const label = item?.labelName;
    if (!item || !this.#setLabelHidden) return;
    if (!label) {
      this.#flash("This record has no label to hide.");
      return;
    }
    try {
      await this.#setLabelHidden(label, true);
    } catch (error) {
      this.#flash(`The label was not hidden: ${errorMessage(error)}`);
      return;
    }
    this.history = [...this.history, { kind: "label", item, label }];
    this.slip = { kind: "label", item, label, id: ++this.#slipSeq };
  }

  undo(): void {
    const entry = this.history.at(-1);
    if (!entry) {
      this.#flash("Nothing to undo.");
      return;
    }
    if (entry.kind === "label") {
      void this.#showLabel(entry);
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
    const slipId = ++this.#slipSeq;
    this.slip = {
      kind: "undo",
      item,
      undone: entry.kind === "verdict" ? entry.status : "pass",
      id: slipId,
    };
    this.#afterMove();
    if (entry.kind !== "verdict") return;
    this.#savingSlip = slipId;
    stats.session -= 1;
    this.#bumpStats(entry.status, entry.previous, -1);
    const client = this.#api.pinned();
    const generation = this.#apiGeneration;
    const answered = this.#startWrite(item.triageKey);
    void this.#write(() => this.#saveUndo(entry, { client, generation, slipId }).finally(answered));
  }

  /** Lets a hidden label back into the queue; saving the filters restarts it. */
  async #showLabel(entry: LabelEntry): Promise<void> {
    this.history = this.history.filter((later) => later !== entry);
    try {
      await this.#setLabelHidden?.(entry.label, false);
    } catch (error) {
      this.history = [...this.history, entry];
      this.#flash(`${entry.label} is still hidden: ${errorMessage(error)}`);
      return;
    }
    this.slip = { kind: "undo", item: entry.item, undone: "label", id: ++this.#slipSeq };
  }

  async #saveUndo(
    entry: VerdictEntry,
    operation: { client: Api; generation: number; slipId: number },
  ): Promise<void> {
    const { client, generation, slipId } = operation;
    try {
      if (entry.previous) await client.postVerdict(entry.previous);
      else await client.deleteVerdict(entry.item.triageKey);
    } catch (error) {
      this.#settleSlip(slipId);
      if (generation !== this.#apiGeneration) return;
      this.#recoverUndo(entry, error);
      return;
    }
    if (generation === this.#apiGeneration) {
      if (isWantlistVerdict(entry.status)) void this.#takeOffWantlist(entry.item, client);
      stats.refreshSoon();
    }
    this.#settleSlip(slipId);
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

  /**
   * Toggles a mark on a track; the same mark again clears it. The moment is the video playing and
   * the second it had reached, saved with the mark.
   */
  markTrack(
    releaseId: number,
    position: string,
    mark: TrackMark,
    moment: { videoId: string; atSeconds: number },
  ): void {
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
      this.#saveTrackMark({ releaseId, position, mark: next, ...moment }, client, {
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

  /** P: asks Discogs for the price and have/want of the record on screen, again if it has them. */
  async price(): Promise<void> {
    const item = this.current;
    if (!item || this.pricing.has(item.id)) return;
    const generation = this.#apiGeneration;
    this.#setPricing(item.id, true);
    try {
      const detail = await this.#api.pinned().enrichRelease(item.id);
      if (generation === this.#apiGeneration) this.#applyEnrichment(detail);
    } catch (error) {
      if (generation === this.#apiGeneration)
        this.#flash(`The price did not load: ${errorMessage(error)}`);
    } finally {
      if (generation === this.#apiGeneration) this.#setPricing(item.id, false);
    }
  }

  #setPricing(releaseId: number, asking: boolean): void {
    const pricing = new Set(this.pricing);
    if (asking) pricing.add(releaseId);
    else pricing.delete(releaseId);
    this.pricing = pricing;
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

  /**
   * Puts a want or grail on the Discogs wantlist once its verdict is saved. An undo before then
   * sends nothing; one after it takes the release off again.
   */
  async #pushWant(entry: HistoryEntry, slipId: number, client: Api): Promise<void> {
    const generation = this.#apiGeneration;
    if (!this.history.includes(entry)) return;
    const push = await this.#pushWithRetries(entry.item, client, {
      generation,
      onRetry: (retryInMs) => this.#showPush(slipId, "retrying", retryInMs),
    });
    if (generation !== this.#apiGeneration) return;
    this.#showPush(slipId, push);
  }

  #showPush(slipId: number, push: PushState | null, retryInMs?: number): void {
    const slip = this.slip;
    if (slip?.kind === "verdict" && slip.id === slipId) this.slip = { ...slip, push, retryInMs };
  }

  /**
   * Tries the push again after each of the retry delays while it fails on the way or in
   * Discogs. Each try decides from the history when it runs, so a want undone meanwhile is not
   * pushed. Returns null when the record is no longer a want or the api mode changed.
   */
  async #pushWithRetries(
    item: QueueItem,
    client: Api,
    retry: { generation: number; onRetry: (retryInMs: number) => void },
  ): Promise<"done" | "failed" | null> {
    const { generation } = retry;
    for (let tries = 0; ; tries += 1) {
      try {
        await this.#syncWantlist(item, client);
        return this.#onWantlist.has(item.triageKey) ? "done" : null;
      } catch (error) {
        if (generation !== this.#apiGeneration) return null;
        const delayMs = this.#pushRetryDelaysMs[tries];
        if (delayMs === undefined || !mayPassLater(error)) {
          this.#flash(
            `${item.artistDisplay} – ${item.title} is not on the Discogs wantlist: ${errorMessage(error)}. A in Twelves tries again.`,
          );
          return "failed";
        }
        retry.onRetry(delayMs);
        await this.#waitBeforeRetry(delayMs);
        if (generation !== this.#apiGeneration) return null;
      }
    }
  }

  /** Resolves after the delay, or at once when the session is destroyed. */
  #waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#retryTimers.delete(timer);
        resolve();
      }, delayMs);
      this.#retryTimers.set(timer, resolve);
    });
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

  /** The newest verdict in the history for the key is a want or a grail. */
  #wanted(key: string): boolean {
    for (const entry of this.history.toReversed()) {
      if (entry.kind === "verdict" && entry.item.triageKey === key)
        return isWantlistVerdict(entry.status);
    }
    return false;
  }

  /**
   * Brings the Discogs wantlist in line with the history for one record. The calls run one at a
   * time and decide when they run, not when they were asked for, so any mix of A, Z and slow
   * requests ends with the release on the wantlist exactly when its latest verdict is a want or
   * a grail.
   */
  #syncWantlist(item: QueueItem, client: Api): Promise<"added" | "removed" | null> {
    const generation = this.#apiGeneration;
    const current = () => generation === this.#apiGeneration;
    const run = this.#wantlistWrites.then(async (): Promise<"added" | "removed" | null> => {
      const key = item.triageKey;
      const pushedId = this.#onWantlist.get(key);
      if (!current()) return null;
      if (this.#wanted(key) && pushedId === undefined) {
        // Twelves may have changed the verdict while the push waited for earlier ones.
        const saved = await client.getRelease(item.id);
        const savedWant = saved.verdict !== null && isWantlistVerdict(saved.verdict.status);
        if (!savedWant || !this.#wanted(key) || !current()) return null;
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
    this.#savingSlip = null;
    this.details = new Map();
    this.detailErrors = new Map();
    this.#loading = new Set();
    this.#trackWrites.clear();
    this.flash = null;
    this.#onWantlist.clear();
    this.#unanswered = new Map();
    this.#roundVerdicts.clear();
    this.notes = new Map();
    this.noteStatus = null;
    this.#noteVersions.clear();
    this.round = null;
    this.#queueBeforeRound = null;
    this.pricing = new Set();
    this.#marketData.clear();
  }

  /** Writes run one at a time, in order, so an undo never overtakes its verdict. */
  #write(fn: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(fn);
    this.#writes = run.catch(() => {});
    return run;
  }

  /**
   * A verdict or undo on its way: until the server answers it, a queue read may not reflect it.
   * Returns what to call once it has answered.
   */
  #startWrite(key: string): () => void {
    // Captured: a write of the other api mode must not count in this one.
    const unanswered = this.#unanswered;
    unanswered.set(key, (unanswered.get(key) ?? 0) + 1);
    for (const written of this.#openReads) written.add(key);
    return () => {
      const left = (unanswered.get(key) ?? 1) - 1;
      if (left > 0) unanswered.set(key, left);
      else unanswered.delete(key);
    };
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
    const { scopeRemaining } = current;
    stats.value = {
      ...current,
      dug: Math.max(0, current.dug + delta),
      remaining: Math.max(0, current.remaining - delta),
      scopeRemaining: scopeRemaining === null ? null : Math.max(0, scopeRemaining - delta),
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
    return this.#reading ?? this.#claimRead(() => this.#appendFresh());
  }

  /** Queue reads run one at a time; a refill asked for meanwhile waits for the read in flight. */
  #claimRead(read: () => Promise<void>): Promise<void> {
    const tracked: Promise<void> = read().finally(() => {
      if (this.#reading === tracked) this.#reading = null;
    });
    this.#reading = tracked;
    return tracked;
  }

  /** Appends the queue's records that are not buffered, passed or being written. */
  async #appendFresh(): Promise<void> {
    const generation = this.#generation;
    const read = await this.#readQueue();
    // A round took over meanwhile; the queue refills again when it ends.
    if (generation !== this.#generation || this.round) return;
    this.#forgetVerdictsGone(read);
    const known = new Set([...read.unsettled, ...keysOf(this.upcoming), ...keysOf(this.passed)]);
    const fresh = read.items.filter((item) => !known.has(item.triageKey));
    this.exhausted = fresh.length === 0;
    this.upcoming = [...this.upcoming, ...fresh];
    this.#prefetch();
  }

  /** Rebuilds the records after the one on screen in the queue's current order. */
  async #rebuildAfterCurrent(): Promise<void> {
    const generation = this.#generation;
    const read = await this.#readQueue();
    if (generation !== this.#generation || this.round) return;
    this.#forgetVerdictsGone(read);
    const upcoming = this.#inQueueOrder(read);
    this.exhausted = read.complete;
    // An unchanged order keeps the list, so the hidden decks keep what they loaded.
    if (!sameItems(upcoming, this.upcoming)) this.upcoming = upcoming;
    this.#prefetch();
  }

  /**
   * The record on screen and the records after it whose undo is still being written, then the
   * queue's records in its order, passes left out. Buffered records keep their market data.
   */
  #inQueueOrder(read: QueueRead): QueueItem[] {
    const [current, ...after] = this.upcoming;
    const undoing = after.filter((item) => read.unsettled.has(item.triageKey));
    const head = current ? [current, ...undoing] : [];
    const leftOut = new Set([...read.unsettled, ...keysOf(head), ...keysOf(this.passed)]);
    const buffered = new Map(this.upcoming.map((item) => [item.triageKey, item]));
    const queued = read.items
      .filter((item) => !leftOut.has(item.triageKey))
      .map((item) => buffered.get(item.triageKey) ?? item);
    return [...head, ...queued];
  }

  /** Asks for what is buffered and a batch more. */
  async #readQueue(): Promise<QueueRead> {
    const unsettled = new Set(this.#unanswered.keys());
    const limit = Math.min(
      MAX_QUEUE_LIMIT,
      this.#batch + this.upcoming.length + this.passed.length,
    );
    this.#openReads.add(unsettled);
    try {
      const response = await this.#api.getQueue({ limit, scope: this.scope ?? undefined });
      return { items: response.items, complete: response.items.length < limit, unsettled };
    } finally {
      this.#openReads.delete(unsettled);
    }
  }

  /**
   * The queue offers only records the server has no verdict for. A verdict this session gave one
   * of them is gone, as when a link pasted in Twelves deletes a no-audio verdict: undo would
   * write over what the server has now, and the record's details predate the change.
   */
  #forgetVerdictsGone(read: QueueRead): void {
    const offered = new Set(keysOf(read.items).filter((key) => !read.unsettled.has(key)));
    const gone = this.history.filter(
      (entry) => entry.kind === "verdict" && offered.has(entry.item.triageKey),
    );
    if (gone.length === 0) return;
    this.history = this.history.filter((entry) => !gone.includes(entry));
    const details = new Map(this.details);
    const detailErrors = new Map(this.detailErrors);
    for (const { item } of gone) {
      details.delete(item.id);
      detailErrors.delete(item.id);
      this.#roundVerdicts.delete(item.triageKey);
    }
    this.details = details;
    this.detailErrors = detailErrors;
  }

  /** Shows a record's fresh market data; its fresh videos too, unless it is playing already. */
  #applyEnrichment(detail: ReleaseDetail): void {
    const id = detail.release.id;
    const snapshot = detail.release.snapshot;
    this.#marketData.set(id, snapshot);
    const refresh = (item: QueueItem) => (item.id === id ? withMarketData(item, snapshot) : item);
    this.upcoming = this.upcoming.map(refresh);
    this.passed = this.passed.map(refresh);
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

function keysOf(items: QueueItem[]): string[] {
  return items.map((item) => item.triageKey);
}

function sameItems(left: QueueItem[], right: QueueItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
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

/** A push that failed on the way or in Discogs may pass later; one the server refused (4xx) will not. */
function mayPassLater(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500;
}
