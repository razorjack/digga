import {
  expectedVerdict,
  type QueueItem,
  type ReleaseDetail,
  type TrackVerdictInput,
} from "../../shared/api.ts";
import { type HiddenLabel, isSameLabel } from "../../shared/config.ts";
import { normalizeNote } from "../../shared/notes.ts";
import type { SessionResolution, SessionState } from "../../shared/digging-session.ts";
import type { PlaybackPosition, ReplayItem } from "../../shared/replay.ts";
import type { QueueScope } from "../../shared/scope.ts";
import { tuneSnapshot } from "../../shared/track-identity.ts";
import type { ReleaseSnapshot, TrackMark, TrackVerdict, Verdict } from "../../shared/types.ts";
import { hasVideoOfLink } from "../../shared/videos.ts";
import { isWantlistVerdict, PUSH_RETRY_DELAYS_MS } from "../../shared/wantlist.ts";
import { type Api, api as appApi, isConflict } from "../api.ts";
import { type CurrentCheck, Generation, SerialQueue } from "../async.ts";
import type { TriageStatus } from "../keymap.ts";
import type { VideosChange } from "../player/triage-player.svelte.ts";
import { errorMessage, settings, stats } from "../stores.svelte.ts";
import { TimedMessage } from "../timed-message.svelte.ts";
import { DetailCache } from "./detail-cache.svelte.ts";
import { countVerdict } from "./optimistic-stats.ts";
import { type QueueRead, QueueReads } from "./queue-reads.ts";
import { WantlistSync } from "./wantlist-sync.ts";
import { type VersionedWrite, WriteVersions } from "./write-versions.ts";

type VerdictEntry = {
  kind: "verdict";
  item: QueueItem;
  status: TriageStatus;
  /** The verdict this one replaced (a record heard again from Twelves); undo restores it. */
  previous: Verdict | null;
  /**
   * The verdict as the server saved it, under the key of the record its release is on now, which a
   * dump load may have changed since the queue was read. Null until the server answers.
   */
  saved: Verdict | null;
};

/** X hid the label of the record on screen; undo lets it back into the queue. */
type LabelEntry = {
  kind: "label";
  item: QueueItem;
  label: HiddenLabel;
  /** The round's other records on the label, which no queue read brings back. */
  roundRecords: QueueItem[];
};

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
  | { kind: "pass"; item: QueueItem; id: number; stays: "queue" | "snoozed" | "saved" }
  | { kind: "label"; item: QueueItem; label: string; id: number }
  | { kind: "undo"; item: QueueItem; undone: TriageStatus | "pass" | "label"; id: number };

/**
 * Records from Twelves heard again ahead of the queue, which resumes where it was afterwards:
 * snoozed records only, or a replay of any shelf or marked track.
 */
export interface Round {
  kind: "snoozed" | "replay";
  total: number;
}

/** Fetch more of the queue when fewer releases than this are buffered. */
const REFILL_BELOW = 8;
/** Release details fetched ahead of the cursor (the next one also feeds the preloading deck). */
const PREFETCH = 3;
const ROUND_FINISHED: Record<Round["kind"], string> = {
  snoozed: "That was every snoozed record in the round; back to the queue.",
  replay: "Replay finished; back to the queue.",
};

export interface SessionOptions {
  /** The waits before each new try of a failed push; PUSH_RETRY_DELAYS_MS unless a test sets them. */
  pushRetryDelaysMs?: number[];
  /** Leaves a label out of the queue filters, or lets it back in. */
  setLabelHidden?: (label: HiddenLabel, hidden: boolean) => Promise<void>;
}

export class TriageSession {
  upcoming = $state.raw<QueueItem[]>([]);
  passed = $state.raw<QueueItem[]>([]);
  history = $state.raw<HistoryEntry[]>([]);
  /** Why a release's videos last changed, which decides whether the player plays what is new. */
  videosChange = $state<VideosChange>("found");
  status = $state<"loading" | "ready" | "error">("loading");
  error = $state<string | null>(null);
  /** The server has nothing beyond what is buffered. */
  exhausted = $state(false);
  slip = $state.raw<Slip | null>(null);
  /** The slip whose verdict or undo is still being written. */
  #savingSlip = $state<number | null>(null);
  #flash = new TimedMessage(6000);
  round = $state.raw<Round | null>(null);
  /** The label, artist or seller the queue is narrowed to; null digs everything the filters let in. */
  scope = $state.raw<QueueScope | null>(null);
  /** Notes written in Triage, by triage key; each is saved as its release's note. */
  notes = $state.raw<ReadonlyMap<string, string | null>>(new Map());
  /** How the last note write went, for the page's status line. */
  noteStatus = $state<string | null>(null);
  /** Releases whose market data P asked Discogs for, until the answer comes. */
  pricing = $state.raw<ReadonlySet<number>>(new Set());

  current = $derived(this.upcoming[0] ?? null);
  next = $derived(this.upcoming[1] ?? null);
  currentDetail = $derived(this.current ? (this.details.get(this.current.id) ?? null) : null);
  nextDetail = $derived(this.next ? (this.details.get(this.next.id) ?? null) : null);
  finished = $derived(this.status === "ready" && this.upcoming.length === 0 && this.exhausted);

  #api: Api;
  #setLabelHidden: SessionOptions["setLabelHidden"];
  #batch = 200;
  /** Market data fetched this session, by release id, for records that moved on before it came. */
  #marketData = new Map<number, ReleaseSnapshot>();
  #details: DetailCache;
  /** Note writes by triage key. */
  #noteWrites = new WriteVersions<string | null>();
  /** Track mark writes by release id and tune. */
  #trackWrites = new WriteVersions<TrackMark | null>();
  #reads: QueueReads;
  /** Each start() begins a new queue, whose reads drop older answers; destroy() ends them all. */
  #queueStarts = new Generation();
  /** The queue as it was when a round started. */
  #queueBeforeRound: { upcoming: QueueItem[]; passed: QueueItem[]; exhausted: boolean } | null =
    null;
  /** rereadQueue() came during a round; the queue is read again once the round ends. */
  #readAfterRound = false;
  /** Verdicts of the records taken into rounds, by triage key. */
  #roundVerdicts = new Map<string, Verdict | null>();
  /** Writes run one at a time, in order, so an undo never overtakes its verdict. */
  #writes = new SerialQueue();
  #slipSeq = 0;
  #wantlist: WantlistSync;

  constructor(api: Api = appApi, opts: SessionOptions = {}) {
    this.#api = api;
    this.#reads = new QueueReads(api);
    this.#details = new DetailCache({
      api,
      writesSettled: () => this.#writes.idle(),
      ended: () => this.#ended,
    });
    this.#wantlist = new WantlistSync({
      api,
      alternativeOptions: () =>
        settings.value?.discogs.alternativePressings ?? {
          whiteLabels: false,
          promos: false,
          testPressings: false,
        },
      retryDelaysMs: opts.pushRetryDelaysMs ?? PUSH_RETRY_DELAYS_MS,
      latestVerdict: (key) => this.#latestVerdict(key),
      flash: (message) => this.#flash.show(message),
    });
    this.#setLabelHidden = opts.setLabelHidden;
  }

  destroy(): void {
    stats.setScope(null);
    this.#queueStarts.end();
    this.#flash.destroy();
    this.#wantlist.destroy();
  }

  async start(batch: number, options: { seed?: number | null } = {}): Promise<void> {
    this.#reads.restart(options.seed ?? null);
    // A restart reads a new queue whose filters may exclude earlier passes.
    this.passed = [];
    this.#batch = batch;
    const isCurrent = this.#queueStarts.next();
    this.status = "loading";
    this.error = null;
    this.upcoming = [];
    this.exhausted = false;
    this.round = null;
    this.#queueBeforeRound = null;
    this.#readAfterRound = false;
    try {
      await this.#readMore();
      if (!isCurrent()) return;
      this.status = "ready";
    } catch (error) {
      if (!isCurrent()) return;
      this.status = "error";
      this.error = errorMessage(error);
    }
  }

  /** destroy() has run; answers that arrive later change nothing. */
  get #ended(): boolean {
    return this.#queueStarts.ended;
  }

  /** Where the session is, by release id; the playback position only for the record on screen. */
  checkpoint(playback: PlaybackPosition | null): SessionState {
    return {
      seed: this.#reads.seed,
      currentId: this.current?.id ?? null,
      passedIds: idsOf(this.passed),
      scope: this.scope,
      roundIds: this.round ? idsOf(this.upcoming) : null,
      queueBeforeRound: this.#cursorBeforeRound(),
      playback: playback?.releaseId === this.current?.id ? playback : null,
    };
  }

  #cursorBeforeRound(): SessionState["queueBeforeRound"] {
    const before = this.#queueBeforeRound;
    if (!before) return null;
    return { currentId: before.upcoming[0]?.id ?? null, passedIds: idsOf(before.passed) };
  }

  /**
   * Reloads the queue in the saved session's scope and order, then puts its passed records, the
   * record that was on screen and the rest of its round back where they were.
   */
  async restoreSession(resolved: SessionResolution): Promise<void> {
    const { state, config } = resolved.session;
    await this.#writes.idle();
    this.history = [];
    this.passed = [];
    this.#roundVerdicts.clear();
    this.#wantlist.forgetRounds();
    this.scope = state.scope;
    stats.setScope(this.scope);

    await this.start(config.queue.limit, { seed: state.seed });
    if (this.status === "error") throw new Error(this.error ?? "Could not reload the queue");

    this.#placeResumedRecords(resolved);
    if (resolved.round?.length) this.startRound(resolved.round);
    this.#afterQueueChange();
    void stats.refresh();
  }

  #placeResumedRecords(resolved: SessionResolution): void {
    const { current, passed } = resolved;
    const placed = new Set(keysOf(passed));
    if (current) placed.add(current.triageKey);
    const rest = this.upcoming.filter((item) => !placed.has(item.triageKey));
    this.passed = passed;
    this.upcoming = current ? [current, ...rest] : rest;
  }

  /**
   * While a load adds records, the end of the queue is only the end of what has arrived: asks the
   * server again, and the next record shows once there is one.
   */
  async readNewArrivals(): Promise<void> {
    if (!this.finished || this.round) return;
    const isCurrent = this.#queueStarts.current();
    try {
      await this.#readMore();
    } catch (error) {
      if (isCurrent()) this.#flash.show(`Could not look for new records: ${errorMessage(error)}`);
    }
  }

  /**
   * The page is shown again, and Twelves may have sent records back to the queue meanwhile, or a
   * hidden label is back. The record on screen stays; the records after it follow the queue's
   * order again. A round keeps its records, and the queue under it is read once it ends.
   */
  async rereadQueue(): Promise<void> {
    if (this.round) {
      this.#readAfterRound = true;
      await this.#refreshRound();
      return;
    }
    if (this.status !== "ready") return;
    const isCurrent = this.#queueStarts.current();
    const inFlight = this.#reads.inFlight;
    try {
      await this.#reads.run(async () => {
        if (inFlight) await inFlight.catch(() => {});
        await this.#rebuildAfterCurrent();
      });
    } catch (error) {
      if (isCurrent()) this.#flash.show(`Could not read the queue again: ${errorMessage(error)}`);
    }
  }

  async #refreshRound(): Promise<void> {
    const round = this.round;
    const isCurrent = this.#queueStarts.current();
    const history = this.history;
    try {
      await this.#writes.idle();
      const response = await this.#api.getTwelves();
      if (!isCurrent() || round !== this.round || history !== this.history) return;
      const saved = new Map(response.items.map((item) => [item.key, item]));
      const records = this.upcoming.map((release) => {
        const item = saved.get(release.triageKey);
        return {
          release,
          verdict: item?.verdict ?? null,
          wantlistReleaseIds: item?.membership.wantlistReleaseIds ?? [],
        };
      });
      for (const record of records) this.#rememberRoundRecord(record);
      this.#refreshRoundDetails(records);
      this.#prefetch();
    } catch (error) {
      if (isCurrent()) this.#flash.show(`Could not refresh the replay: ${errorMessage(error)}`);
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
    void stats.refresh();
  }

  judge(status: TriageStatus): void {
    const item = this.current;
    if (!item) return;
    const previous = this.#roundVerdicts.get(item.triageKey) ?? this.currentDetail?.verdict ?? null;

    const entry: VerdictEntry = { kind: "verdict", item, status, previous, saved: null };
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
    this.#countVerdict(entry, 1);
    this.#afterQueueChange();
    const answered = this.#reads.startWrite(item.triageKey);
    void this.#writes.run(() => this.#saveVerdict(entry, id).finally(answered));
  }

  async #saveVerdict(entry: VerdictEntry, slipId: number): Promise<void> {
    const { item, status } = entry;
    try {
      entry.saved = await this.#api.postVerdict({
        key: item.triageKey,
        status,
        releaseId: item.id,
        expected: entry.previous ? expectedVerdict(entry.previous) : undefined,
      });
    } catch (error) {
      this.#settleSlip(slipId);
      if (this.#ended) return;
      this.#recoverVerdict(entry, error);
      return;
    }
    if (!this.#ended) {
      stats.refreshSoon();
      // Discogs writes have their own chain so they cannot delay verdicts.
      if (isWantlistVerdict(status)) void this.#pushWant(entry, slipId);
      else if (replacedWant(entry)) void this.#wantlist.takeOff(item);
    }
    // Last, so a settled slip means its push has started.
    this.#settleSlip(slipId);
  }

  #settleSlip(slipId: number): void {
    if (this.#savingSlip === slipId) this.#savingSlip = null;
  }

  #recoverVerdict(entry: VerdictEntry, error: unknown): void {
    this.#flash.show(`The verdict was not saved: ${errorMessage(error)}`);
    stats.refreshSoon(0);
    if (!this.history.includes(entry)) return;
    this.history = this.history.filter((item) => item !== entry);
    this.#returnToQueue(entry.item);
    if (isConflict(error)) this.retryDetail(entry.item.id);
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

  /** The details of the releases around the cursor and in the recent history, by release id. */
  get details(): ReadonlyMap<number, ReleaseDetail> {
    return this.#details.details;
  }

  /** Why each failed detail read failed, by release id; Enter reads it again. */
  get detailErrors(): ReadonlyMap<number, string> {
    return this.#details.errors;
  }

  /** A short message about what just failed or happened, which clears itself. */
  get flash(): string | null {
    return this.#flash.text;
  }

  /** The slip reports a write the server has not answered yet, or the page has not acted on. */
  get slipBusy(): boolean {
    return this.slip !== null && this.#savingSlip === this.slip.id;
  }

  /** The release's note: written in this session, else the saved one. */
  noteFor(item: QueueItem): string | null {
    if (this.notes.has(item.triageKey)) return this.notes.get(item.triageKey) ?? null;
    return this.#details.get(item.id)?.note ?? null;
  }

  /** Saves a note without making or changing a judgement; an empty note removes it. */
  setNote(item: QueueItem, text: string): void {
    const key = item.triageKey;
    const write = this.#noteWrites.begin(key, this.noteFor(item));
    const note = normalizeNote(text);
    this.notes = new Map(this.notes).set(key, note);
    this.noteStatus = "Saving note…";

    const isLatest = () => !this.#ended && write.isLatest();
    void this.#writes.run(async () => {
      try {
        await this.#api.putReleaseNote(item.id, note);
        write.markSaved(note);
        if (!isLatest()) return;
        this.noteStatus = "Note saved.";
      } catch (error) {
        if (!isLatest()) return;
        this.notes = new Map(this.notes).set(key, write.saved());
        this.noteStatus = `Note not saved: ${errorMessage(error)}`;
      }
    });
  }

  /** N: leave the release undecided and move on; it comes back when the queue goes round. */
  pass(): void {
    const item = this.current;
    if (!item) {
      this.goRoundPassed();
      return;
    }
    this.upcoming = this.upcoming.slice(1);
    this.passed = [...this.passed, item];
    this.history = [...this.history, { kind: "pass", item }];
    this.slip = {
      kind: "pass",
      item,
      id: ++this.#slipSeq,
      stays: this.#passDestination(item.triageKey),
    };
    this.#afterQueueChange();
  }

  #passDestination(key: string): "queue" | "snoozed" | "saved" {
    if (!this.#roundVerdicts.has(key)) return "queue";
    return this.#roundVerdicts.get(key)?.status === "snoozed" ? "snoozed" : "saved";
  }

  /** Hear saved records ahead of the queue. Only an explicit verdict changes their decisions. */
  startRound(items: ReplayItem[]): void {
    const records = items.filter(
      (item): item is ReplayItem & { release: QueueItem } => item.release !== null,
    );
    if (records.length === 0) return;
    this.#queueBeforeRound ??= {
      upcoming: this.upcoming,
      passed: this.passed,
      exhausted: this.exhausted,
    };
    for (const record of records) this.#rememberRoundRecord(record);
    this.#refreshRoundDetails(records);
    const allSnoozed = records.every((record) => record.verdict?.status === "snoozed");

    this.upcoming = records.map((record) => record.release);
    this.passed = [];
    this.exhausted = true;
    this.round = { kind: allSnoozed ? "snoozed" : "replay", total: records.length };
    this.status = "ready";
    this.slip = null;
    this.#afterQueueChange();
  }

  /** Twelves may have edited these records while Triage kept its cached details. */
  #refreshRoundDetails(records: (ReplayItem & { release: QueueItem })[]): void {
    this.#details.forget(records.map(({ release }) => release.id));
    const notes = new Map(this.notes);
    for (const { release } of records) {
      notes.delete(release.triageKey);
      this.#noteWrites.forget(release.triageKey);
    }
    this.notes = notes;
    this.noteStatus = null;
  }

  /** The saved verdict and wantlist state a verdict in the round replaces, and undo restores. */
  #rememberRoundRecord(record: ReplayItem & { release: QueueItem }): void {
    const key = record.release.triageKey;
    this.#roundVerdicts.set(key, record.verdict);
    if (record.wantlistReleaseIds !== undefined)
      this.#wantlist.rememberRoundRecord(key, record.wantlistReleaseIds);
  }

  /** Esc during a round, or its last record: back to the queue where it was. */
  endRound(): void {
    const saved = this.#queueBeforeRound;
    if (!this.round || !saved) return;
    this.#queueBeforeRound = null;
    this.round = null;
    const judged = new Set(
      this.history.filter((entry) => entry.kind === "verdict").map((entry) => entry.item.triageKey),
    );
    // Queue releases that undo brought back during the round stay in front.
    const returned = this.upcoming.filter((item) => !this.#roundVerdicts.has(item.triageKey));
    const returnedKeys = new Set(returned.map((item) => item.triageKey));
    this.upcoming = [
      ...returned,
      ...saved.upcoming.filter(
        (item) => !judged.has(item.triageKey) && !returnedKeys.has(item.triageKey),
      ),
    ];
    this.passed = saved.passed;
    this.exhausted = saved.exhausted;
    this.#afterQueueChange();
    if (!this.#readAfterRound) return;
    this.#readAfterRound = false;
    void this.rereadQueue();
  }

  /** At the end of the queue, starts again on the releases passed with N. */
  goRoundPassed(): void {
    if (this.upcoming.length > 0 || this.passed.length === 0) return;
    this.upcoming = this.passed;
    this.passed = [];
    this.slip = null;
    this.#afterQueueChange();
  }

  /** X: leaves every record on the current record's label out of the queue; Z lets them back. */
  async hideLabel(): Promise<void> {
    const item = this.current;
    if (!item || !this.#setLabelHidden) return;
    if (!item.labelName) {
      this.#flash.show("This record has no label to hide.");
      return;
    }
    const label = { id: item.labelId, name: item.labelName };
    // Triage leaves the label out as soon as the saved settings arrive, which can be before the
    // save's promise settles here.
    const roundRecords = this.round
      ? this.upcoming.filter((other) => other !== item && isOnLabel(other, label))
      : [];
    try {
      await this.#setLabelHidden(label, true);
    } catch (error) {
      this.#flash.show(`The label was not hidden: ${errorMessage(error)}`);
      return;
    }
    this.leaveOutLabel(label);
    this.history = [...this.history, { kind: "label", item, label, roundRecords }];
    this.slip = { kind: "label", item, label: label.name, id: ++this.#slipSeq };
  }

  /**
   * The label's records leave the buffers, a round's and the queue's, without a restart; the
   * saved filters leave them out of later reads. A read sent before they were saved can still
   * bring some, so they leave again when it lands.
   */
  leaveOutLabel(label: HiddenLabel): void {
    this.#dropLabel(label);
    void this.#reads.inFlight?.then(
      () => {
        if (!this.#ended) this.#dropLabel(label);
      },
      // A read that failed brought nothing.
      () => {},
    );
  }

  #dropLabel(label: HiddenLabel): void {
    const kept = (item: QueueItem) => !isOnLabel(item, label);
    this.upcoming = this.upcoming.filter(kept);
    this.passed = this.passed.filter(kept);
    const saved = this.#queueBeforeRound;
    if (saved)
      this.#queueBeforeRound = {
        ...saved,
        upcoming: saved.upcoming.filter(kept),
        passed: saved.passed.filter(kept),
      };
    this.#afterQueueChange();
  }

  undo(): void {
    const entry = this.history.at(-1);
    if (!entry) {
      this.#flash.show("Nothing to undo.");
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
    this.#afterQueueChange();
    if (entry.kind !== "verdict") return;
    this.#savingSlip = slipId;
    stats.session -= 1;
    this.#countVerdict(entry, -1);
    const answered = this.#reads.startWrite(item.triageKey);
    void this.#writes.run(() => this.#saveUndo(entry, slipId).finally(answered));
  }

  /**
   * Lets a hidden label back into the queue. The record X was pressed on comes back first, as
   * after any undo, and a round gets back its other records on the label; Triage reads the queue
   * again for the label's others once the filters are saved.
   */
  async #showLabel(entry: LabelEntry): Promise<void> {
    this.history = this.history.filter((later) => later !== entry);
    try {
      await this.#setLabelHidden?.(entry.label, false);
    } catch (error) {
      this.history = [...this.history, entry];
      this.#flash.show(`${entry.label.name} is still hidden: ${errorMessage(error)}`);
      return;
    }
    if (this.round) this.upcoming = [...entry.roundRecords, ...this.upcoming];
    this.#returnToQueue(entry.item);
    this.#afterQueueChange();
    this.slip = { kind: "undo", item: entry.item, undone: "label", id: ++this.#slipSeq };
  }

  async #saveUndo(entry: VerdictEntry, slipId: number): Promise<void> {
    try {
      await undoVerdict(this.#api, entry);
    } catch (error) {
      this.#settleSlip(slipId);
      if (this.#ended) return;
      this.#recoverUndo(entry, error);
      return;
    }
    if (!this.#ended) {
      // Syncs the wantlist with the restored verdict, whichever way the undo moved it.
      if (isWantlistVerdict(entry.status) || replacedWant(entry))
        void this.#wantlist.takeOff(entry.item);
      stats.refreshSoon();
    }
    this.#settleSlip(slipId);
  }

  #recoverUndo(entry: VerdictEntry, error: unknown): void {
    this.#flash.show(`Undo failed: ${errorMessage(error)}`);
    const key = entry.item.triageKey;
    // A later action on this record owns its optimistic state.
    if (!this.history.some((later) => later.item.triageKey === key)) {
      // A verdict changed elsewhere since leaves nothing this tab can undo.
      if (!isConflict(error)) {
        this.history = [...this.history, entry];
        stats.session += 1;
      }
      this.upcoming = this.upcoming.filter((item) => item.triageKey !== key);
      this.slip = null;
    }
    stats.refreshSoon(0);
  }

  /**
   * Toggles a mark on the playing track's tune; the same mark again clears it. The moment is the
   * video playing and the second it had reached, saved with the mark.
   */
  markTrack(
    releaseId: number,
    playing: { position: string; heardKey: string },
    mark: TrackMark,
    moment: { videoId: string; atSeconds: number },
  ): void {
    const track = this.#details
      .get(releaseId)
      ?.tracks.find((candidate) => candidate.heardKey === playing.heardKey);
    if (!track) return;

    const next = track.mark === mark ? null : mark;
    const input: TrackVerdictInput = {
      releaseId,
      position: playing.position,
      tune: tuneSnapshot(track),
      mark: next,
      ...moment,
    };

    const write = this.#trackWrites.begin(`${releaseId}\n${track.heardKey}`, track.mark);
    this.#setTrackMark(releaseId, track.heardKey, next);

    void this.#writes.run(() => this.#saveTrackMark(input, write));
  }

  /** Shows the mark on every track of the release with the tune. */
  #setTrackMark(releaseId: number, heardKey: string, mark: TrackMark | null): void {
    this.#details.update(releaseId, (detail) => ({
      ...detail,
      tracks: detail.tracks.map((track) =>
        track.heardKey === heardKey ? { ...track, mark } : track,
      ),
    }));
  }

  async #saveTrackMark(
    input: TrackVerdictInput,
    write: VersionedWrite<TrackMark | null>,
  ): Promise<void> {
    const { releaseId, tune } = input;
    try {
      const saved = await this.#api.postTrackVerdict(input);
      if (this.#ended) return;
      write.markSaved(input.mark);
      this.#replaceTrackVerdict(releaseId, tune.heardKey, saved);
    } catch (error) {
      if (this.#ended) return;
      // Later queued marks own their optimistic value until their own write settles.
      if (write.isLatest()) this.#setTrackMark(releaseId, tune.heardKey, write.saved());
      this.#flash.show(`The track mark was not saved: ${errorMessage(error)}`);
    }
  }

  /** Keeps the detail's saved marks in step with the server. */
  #replaceTrackVerdict(releaseId: number, heardKey: string, saved: TrackVerdict | null): void {
    this.#details.update(releaseId, (detail) => {
      const trackVerdicts = detail.trackVerdicts.filter((mark) => mark.heardKey !== heardKey);
      if (saved) trackVerdicts.push(saved);
      return { ...detail, trackVerdicts };
    });
  }

  /** Attaches a YouTube link to the record on screen; the player picks the video up. */
  async attachVideo(url: string): Promise<void> {
    const item = this.current;
    if (!item) return;
    if (hasVideoOfLink(this.currentDetail?.videos ?? [], url)) {
      this.#flash.show("Already attached to this release.");
      return;
    }
    try {
      const attached = await this.#api.attachVideo(item.id, url);
      if (this.#ended) return;
      this.videosChange = "attached";
      this.#details.set(item.id, withShownMarks(attached, this.#details.get(item.id)));
      this.#flash.show("Attached to this release; it plays here from now on.");
    } catch (error) {
      if (!this.#ended) this.#flash.show(`The link was not attached: ${errorMessage(error)}`);
    }
  }

  /** P: asks Discogs for the price and have/want of the record on screen, again if it has them. */
  async price(): Promise<void> {
    const item = this.current;
    if (!item || this.pricing.has(item.id)) return;
    this.#setPricing(item.id, true);
    try {
      const detail = await this.#api.enrichRelease(item.id);
      if (!this.#ended) this.#applyEnrichment(detail);
    } catch (error) {
      if (!this.#ended) this.#flash.show(`The price did not load: ${errorMessage(error)}`);
    } finally {
      if (!this.#ended) this.#setPricing(item.id, false);
    }
  }

  #setPricing(releaseId: number, asking: boolean): void {
    const pricing = new Set(this.pricing);
    if (asking) pricing.add(releaseId);
    else pricing.delete(releaseId);
    this.pricing = pricing;
  }

  /** Reads a release's detail again; a record in a round also takes its verdict from it. */
  retryDetail(id: number): void {
    void this.#details.retry(id).then((detail) => {
      if (detail) this.#refreshRoundVerdict(detail);
    });
  }

  #refreshRoundVerdict(detail: ReleaseDetail): void {
    const key = detail.release.triageKey;
    if (this.#roundVerdicts.has(key)) this.#roundVerdicts.set(key, detail.verdict);
  }

  showFlash(message: string): void {
    this.#flash.show(message);
  }

  /**
   * Puts a want or grail on the Discogs wantlist once its verdict is saved. An undo before then
   * sends nothing; one after it takes the release off again.
   */
  async #pushWant(entry: HistoryEntry, slipId: number): Promise<void> {
    if (!this.history.includes(entry)) return;
    const push = await this.#wantlist.push(entry.item, (retryInMs) =>
      this.#showPush(slipId, "retrying", retryInMs),
    );
    if (this.#ended) return;
    this.#showPush(slipId, push);
  }

  #showPush(slipId: number, push: PushState | null, retryInMs?: number): void {
    const slip = this.slip;
    if (slip?.kind === "verdict" && slip.id === slipId) this.slip = { ...slip, push, retryInMs };
  }

  /** The newest verdict the history holds for the record; undefined when it holds none. */
  #latestVerdict(key: string): TriageStatus | undefined {
    for (const entry of this.history.toReversed()) {
      if (entry.kind === "verdict" && entry.item.triageKey === key) return entry.status;
    }
    return undefined;
  }

  #countVerdict(entry: VerdictEntry, delta: 1 | -1): void {
    if (stats.value) stats.value = countVerdict(stats.value, entry, delta);
  }

  /**
   * After records moved in or out of the buffers: ends a round left empty, reads the details
   * ahead, and reads more of the queue when few records are left.
   */
  #afterQueueChange(): void {
    if (this.round && this.upcoming.length === 0) {
      const { kind } = this.round;
      this.endRound();
      this.#flash.show(ROUND_FINISHED[kind]);
      return;
    }
    this.#prefetch();
    if (!this.exhausted && this.upcoming.length < REFILL_BELOW) {
      const isCurrent = this.#queueStarts.current();
      this.#readMore().catch((error: unknown) => {
        if (!isCurrent()) return;
        const message = `Could not fetch more of the queue: ${errorMessage(error)}`;
        this.#flash.show(message);
        // With nothing buffered, the page needs the error state so Enter can retry.
        if (this.upcoming.length === 0) {
          this.status = "error";
          this.error = message;
        }
      });
    }
    this.#prune();
  }

  /** Reads another batch of the queue, or waits for the read already out. */
  #readMore(): Promise<void> {
    return this.#reads.inFlight ?? this.#reads.run(() => this.#appendFresh());
  }

  /** Appends a batch of the queue's records that are not buffered, passed or being written. */
  async #appendFresh(): Promise<void> {
    const isCurrent = this.#queueStarts.current();
    const read = await this.#readQueue(this.#batch, [...this.upcoming, ...this.passed], isCurrent);
    // A round took over meanwhile; the queue refills again when it ends.
    if (!isCurrent() || this.round) return;
    this.#forgetVerdictsGone(read);
    // A pass or an undo while the read was out can have buffered one of its records already.
    const known = new Set([...read.unsettled, ...keysOf(this.upcoming), ...keysOf(this.passed)]);
    const fresh = read.items.filter((item) => !known.has(item.triageKey));
    this.exhausted = read.complete;
    this.upcoming = [...this.upcoming, ...fresh];
    this.#prefetch();
  }

  /** Rebuilds the records after the one on screen in the queue's current order. */
  async #rebuildAfterCurrent(): Promise<void> {
    const isCurrent = this.#queueStarts.current();
    const current = this.upcoming.slice(0, 1);
    const read = await this.#readQueue(
      this.#batch + this.upcoming.length,
      [...current, ...this.passed],
      isCurrent,
    );
    if (!isCurrent() || this.round) return;
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

  #readQueue(wanted: number, held: QueueItem[], isCurrent: CurrentCheck): Promise<QueueRead> {
    return this.#reads.read({ wanted, held: keysOf(held), scope: this.scope, isCurrent });
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
    this.#details.forget(gone.map(({ item }) => item.id));
    for (const { item } of gone) this.#roundVerdicts.delete(item.triageKey);
  }

  /**
   * Shows a record's fresh market data and videos; the player picks up a new video. The rest of
   * the loaded detail stays, since a track mark may still be on its way to the server.
   */
  #applyEnrichment(enriched: ReleaseDetail): void {
    const id = enriched.release.id;
    const snapshot = enriched.release.snapshot;
    this.#marketData.set(id, snapshot);
    const refresh = (item: QueueItem) => (item.id === id ? withMarketData(item, snapshot) : item);
    this.upcoming = this.upcoming.map(refresh);
    this.passed = this.passed.map(refresh);

    if (!this.#details.get(id)) return;
    this.videosChange = "found";
    this.#details.update(id, (loaded) => ({
      ...loaded,
      release: enriched.release,
      videos: enriched.videos,
    }));
  }

  #prefetch(): void {
    this.#details.prefetch(idsOf(this.upcoming.slice(0, PREFETCH)));
  }

  /** Keeps details for the releases ahead and the recent history (undo returns to them). */
  #prune(): void {
    const keep = new Set([
      ...idsOf(this.upcoming.slice(0, PREFETCH)),
      ...this.history.slice(-20).map((entry) => entry.item.id),
    ]);
    this.#details.prune(keep);
  }
}

/**
 * The attach's answer with the track marks the session shows. The attach changes no mark, and the
 * answer misses the marks whose writes are still queued.
 */
function withShownMarks(attached: ReleaseDetail, shown: ReleaseDetail | null): ReleaseDetail {
  if (!shown) return attached;
  const shownMarks = new Map(shown.tracks.map((track) => [track.heardKey, track.mark]));
  const tracks = attached.tracks.map((track) => {
    const mark = shownMarks.get(track.heardKey);
    return mark === undefined ? track : { ...track, mark };
  });
  return { ...attached, tracks, trackVerdicts: shown.trackVerdicts };
}

function isOnLabel(item: QueueItem, label: HiddenLabel): boolean {
  return isSameLabel({ id: item.labelId, name: item.labelName ?? "" }, label);
}

function idsOf(items: QueueItem[]): number[] {
  return items.map((item) => item.id);
}

/** The verdict replaced a want or a grail, which may still be on the Discogs wantlist. */
function replacedWant(entry: VerdictEntry): boolean {
  return entry.previous !== null && isWantlistVerdict(entry.previous.status);
}

function keysOf(items: QueueItem[]): string[] {
  return items.map((item) => item.triageKey);
}

function sameItems(left: QueueItem[], right: QueueItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function withMarketData(item: QueueItem, snapshot: ReleaseSnapshot): QueueItem {
  return { ...item, ...snapshot };
}

/**
 * Puts back the verdict a triage verdict replaced, or deletes it, while the record still has the
 * verdict this tab saved. A verdict the server never saved leaves nothing to undo there.
 */
async function undoVerdict(client: Api, entry: VerdictEntry): Promise<void> {
  const { saved, previous } = entry;
  if (saved === null) return;
  const expected = expectedVerdict(saved);
  if (previous) await client.postVerdict({ ...previous, expected });
  else await client.deleteVerdict(saved.key, expected);
}
