import {
  ImportJobInputSchema,
  ListenLogInputSchema,
  TrackVerdictInputSchema,
  TWELVES_STATUSES,
  VerdictInputSchema,
  type DiscogsListEntry,
  type MarkedTrack,
  type QueueItem,
  type ReleaseDetail,
  type TrackVerdictInput,
  type TuneSnapshot,
  type TwelvesItem,
} from "../shared/api.ts";
import { formatSummary } from "../shared/formats.ts";
import { rateSummary } from "../shared/rate.ts";
import { type ScopeRef, scopeKey } from "../shared/scope.ts";
import { assertTrackIdentity, markForTrack } from "../shared/track-identity.ts";
import type {
  Job,
  RecordMembership,
  TrackVerdict,
  Verdict,
  VerdictStatus,
} from "../shared/types.ts";
import { isTriageSource } from "../shared/verdict-rank.ts";
import type { Api } from "./api.ts";

export interface SandboxOptions {
  now?: () => Date;
  /** Simulated round trip of a Discogs wantlist write, so the UI shows its pending state. */
  pushDelayMs?: number;
  /** Largest queue page requested from the server (its own cap is 5000). */
  queuePageLimit?: number;
}

interface LocalVerdict {
  verdict: Verdict;
  /** The server's verdict for the key: null when it was undecided there, undefined when unknown. */
  base: Verdict | null | undefined;
}

const MAX_QUEUE_LIMIT = 5000;

const markKey = (releaseId: number, position: string) => `${releaseId}\n${position}`;

/** The track still at the mark's position with the mark's tune, as the server's list matches it. */
function isMarkedTrack(track: TuneSnapshot & { position: string }, mark: TrackVerdict): boolean {
  if (track.position !== mark.position) return false;
  return !mark.heardKey || track.heardKey === mark.heardKey;
}

function queueItemFromDetail(detail: ReleaseDetail, videoCount: number): QueueItem {
  const release = detail.release;
  return {
    id: release.id,
    triageKey: release.triageKey,
    masterId: release.masterId,
    title: release.title,
    artistDisplay: release.artistDisplay,
    labelId: release.labels[0]?.id ?? null,
    labelName: release.labelName,
    catno: release.catno,
    year: release.year,
    country: release.country,
    formatSummary: formatSummary(release.formats),
    styles: release.styles,
    videoCount,
    communityWant: release.snapshot.communityWant,
    communityHave: release.snapshot.communityHave,
    numForSale: release.snapshot.numForSale,
    lowestPrice: release.snapshot.lowestPrice,
    currency: release.snapshot.currency,
    enrichedAt: release.snapshot.enrichedAt,
  };
}

/**
 * An Api that fakes the digging writes in memory: verdicts, track marks, listens, wantlist
 * pushes and the Maybe list import. None of them reach the database or Discogs, and a reload
 * starts from the server's state again. Reads are overlaid with the fake writes, so the queue,
 * counters, Twelves, heard tracks and undo behave as if the writes had happened. Settings, the
 * Discogs token and the other jobs (dump download, load and update, collection, wantlist and
 * history imports) set the app up rather than dig, so they go to the server.
 */
export function createSandboxApi(inner: Api, options: SandboxOptions = {}): Api {
  return new SandboxApi(inner, options);
}

class SandboxApi implements Api {
  #inner: Api;
  #now: () => Date;
  #pushDelayMs: number;
  #queuePageLimit: number;
  constructor(inner: Api, options: SandboxOptions) {
    this.#inner = inner;
    this.#now = options.now ?? (() => new Date());
    this.#pushDelayMs = options.pushDelayMs ?? 350;
    this.#queuePageLimit = options.queuePageLimit ?? MAX_QUEUE_LIMIT;
  }
  #verdicts = new Map<string, LocalVerdict>();

  /** Server verdicts observed before local edits; null means undecided. */
  #serverVerdicts = new Map<string, Verdict | null>();

  #marks = new Map<string, TrackVerdict | null>();

  /** Only keys first heard in this sandbox contribute to the heard count. */
  #heard = new Set<string>();

  #releases = new Map<number, QueueItem>();

  /** Triage keys each scope's queue returned, so its count subtracts only its own verdicts. */
  #scopeKeys = new Map<string, Set<string>>();

  #details = new Map<number, ReleaseDetail>();

  /** True adds a triage key to the wantlist; false removes it. */
  #wantlist = new Map<string, boolean>();

  #jobs = new Map<
    string,
    {
      job: Job;
    }
  >();

  /** Triage keys the server listed on the wantlist in the latest Twelves or track marks read. */
  #serverWantlist = new Set<string>();

  /** Records the Maybe-list read in this sandbox put on the list, with the release to show. */
  #listed = new Map<string, QueueItem | null>();

  /** Triage keys the server listed on the Maybe list in the latest Twelves read. */
  #serverListed = new Set<string>();

  /** The queue filter of the same name, as the latest queue or stats read found it. */
  #skipHistory = true;

  /** The tune each mark made in the sandbox was first saved with, by markKey(). */
  #markTunes = new Map<string, TuneSnapshot>();

  /** Release notes written in the sandbox, by release id. */
  #notes = new Map<number, string | null>();

  #listenSeq = 0;

  #jobSeq = 0;

  #rememberRelease = (item: QueueItem) => {
    this.#releases.set(item.id, item);
  };

  #overlayDetail = (detail: ReleaseDetail): ReleaseDetail => {
    const trackVerdicts = new Map(
      detail.trackVerdicts.map((trackVerdict) => [trackVerdict.position, trackVerdict]),
    );
    for (const [key, trackVerdict] of this.#marks) {
      const [releaseId, position] = key.split("\n") as [string, string];
      if (Number(releaseId) !== detail.release.id) continue;
      if (trackVerdict) trackVerdicts.set(position, trackVerdict);
      else trackVerdicts.delete(position);
    }
    const marks = [...trackVerdicts.values()];
    const releaseId = detail.release.id;
    return {
      ...detail,
      note: this.#notes.has(releaseId) ? this.#notes.get(releaseId) : detail.note,
      tracks: detail.tracks.map((track) => ({
        ...track,
        heard: track.heard || this.#heard.has(track.heardKey),
        mark: markForTrack(track, marks, detail.tracks)?.mark ?? null,
      })),
      trackVerdicts: marks,
      verdict: this.#verdicts.get(detail.release.triageKey)?.verdict ?? detail.verdict,
    };
  };

  #keyForRelease = (id: number): string | null =>
    this.#releases.get(id)?.triageKey ?? this.#details.get(id)?.release.triageKey ?? null;

  #fakeWantlistWrite = async (releaseId: number, on: boolean) => {
    await new Promise((resolve) => setTimeout(resolve, this.#pushDelayMs));
    const key = this.#keyForRelease(releaseId);
    if (key !== null) this.#wantlist.set(key, on);
    return { releaseId, ok: true };
  };

  #releaseFor = (inputVerdict: Verdict): QueueItem | null => {
    if (inputVerdict.releaseId === null) return null;
    const cached = this.#releases.get(inputVerdict.releaseId);
    if (cached) return cached;
    const detail = this.#details.get(inputVerdict.releaseId);
    return detail ? queueItemFromDetail(detail, detail.videos.length) : null;
  };

  /** Records taken out of the queue in this sandbox reduce the remaining count. */
  #newlyDecided = () =>
    [...new Set([...this.#verdicts.keys(), ...this.#listed.keys()])].filter((key) =>
      this.#leftQueue(key),
    ).length;

  /**
   * The queue holds a record with this verdict: none (null), or a history "seen" while the
   * filters do not skip history. Undefined is a verdict the sandbox never saw.
   */
  #isQueued(verdict: Verdict | null | undefined): boolean {
    if (verdict === null) return true;
    return verdict?.status === "seen" && !this.#skipHistory;
  }

  /** The server's queue had the record, and a verdict or a list read here took it out. */
  #leftQueue(key: string): boolean {
    const local = this.#verdicts.get(key);
    if (!this.#isQueued(local ? local.base : this.#serverVerdicts.get(key))) return false;
    return (local !== undefined && !this.#isQueued(local.verdict)) || this.#listed.has(key);
  }

  /** A wantlist change made in the sandbox wins over what the server reports. */
  #isOnWantlist(release: QueueItem | null, onServer: boolean): boolean {
    if (!release) return false;
    return this.#wantlist.get(release.triageKey) ?? onServer;
  }

  #keysInScope = (scope: ScopeRef): Set<string> => {
    const keys = this.#scopeKeys.get(scopeKey(scope)) ?? new Set<string>();
    this.#scopeKeys.set(scopeKey(scope), keys);
    return keys;
  };

  /**
   * A server count of records to dig, less those decided in this sandbox. In a scope only the
   * keys its queue returned count, which is all of them once the queue has paged through it.
   */
  #remainingAfterLocal = (remaining: number, scope?: ScopeRef): number => {
    if (!scope) return Math.max(0, remaining - this.#newlyDecided());
    const keys = [...this.#keysInScope(scope)];
    const decided = keys.filter((key) => this.#leftQueue(key)).length;
    return Math.max(0, remaining - decided);
  };

  /** Records judged in this sandbox that were not judged in Digga on the server, and back. */
  #dugDelta = () => {
    let delta = 0;
    for (const { verdict, base } of this.#verdicts.values()) {
      const wasDug = base ? isTriageSource(base.source) : false;
      const isDug = isTriageSource(verdict.source);
      if (isDug && !wasDug) delta += 1;
      if (!isDug && wasDug) delta -= 1;
    }
    return delta;
  };

  /** Uses the real list as read-only input and holds its records on the list in memory. */
  #applyListSeeds = async (
    listId: number,
    job: {
      job: Job;
    },
  ): Promise<void> => {
    const list = await this.#inner.getDiscogsList(listId);
    let written = 0;
    for (const entry of list.entries) {
      if (this.#applyListEntry(entry)) written += 1;
    }
    job.job = {
      ...job.job,
      status: "done",
      type: "import_list",
      progress: {
        page: 1,
        pages: 1,
        processed: list.entries.length,
        stubs: 0,
        added: written,
      },
      finishedAt: this.#now().toISOString(),
    };
  };

  /** Holds the entry's record on the list; true when neither this sandbox nor the server did. */
  #applyListEntry(entry: DiscogsListEntry): boolean {
    if (entry.release) this.#rememberRelease(entry.release);
    const { owned, onWantlist, onList } = entry.membership;
    // A record the account holds already was never in the queue, whatever its verdict.
    if (!this.#serverVerdicts.has(entry.key) && !owned && !onWantlist && !onList)
      this.#serverVerdicts.set(entry.key, entry.verdict);
    if (onList) this.#serverListed.add(entry.key);
    if (this.#listed.has(entry.key) || this.#serverListed.has(entry.key)) return false;
    this.#listed.set(entry.key, entry.release);
    return true;
  }

  #startListImport = (listId: number): Job => {
    this.#jobSeq += 1;
    const stamp = this.#now().toISOString();
    const fake: {
      job: Job;
    } = {
      job: {
        id: `sandbox-${this.#jobSeq}`,
        type: "import_list",
        status: "running",
        progress: { page: 1, pages: 1, processed: 0, stubs: 0, added: 0 },
        error: null,
        createdAt: stamp,
        startedAt: stamp,
        finishedAt: null,
      },
    };
    this.#jobs.set(fake.job.id, fake);
    this.#applyListSeeds(listId, fake).catch((error: unknown) => {
      fake.job = {
        ...fake.job,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: this.#now().toISOString(),
      };
    });
    return { ...fake.job };
  };
  readonly mode = "sandbox";

  getLatestSession: Api["getLatestSession"] = async () => null;
  putSession: Api["putSession"] = async () => ({ saved: false });
  resolveSession: Api["resolveSession"] = async () => {
    throw new Error("Sandbox sessions are not saved.");
  };

  getQueue: Api["getQueue"] = async (query = {}) => {
    const want = query.limit ?? (await this.#inner.getSettings()).queue.limit;
    // Locally decided keys are still undecided on the server, so page past them.
    const limit = Math.min(this.#queuePageLimit, want + this.#verdicts.size);
    const inScope = query.scope ? this.#keysInScope(query.scope) : null;
    const items: QueueItem[] = [];
    let offset = query.offset ?? 0;
    for (;;) {
      const response = await this.#inner.getQueue({ ...query, limit, offset });
      this.#skipHistory = response.filters.skipHistory;
      for (const item of response.items) {
        this.#rememberRelease(item);
        inScope?.add(item.triageKey);
        if (!this.#serverVerdicts.has(item.triageKey))
          this.#serverVerdicts.set(item.triageKey, null);
        const local = this.#verdicts.get(item.triageKey);
        const stillQueued =
          (!local || this.#isQueued(local.verdict)) && !this.#listed.has(item.triageKey);
        if (stillQueued && items.length < want) items.push(item);
      }
      offset += response.items.length;
      if (items.length >= want || response.items.length < limit)
        return {
          ...response,
          items,
          remaining: this.#remainingAfterLocal(response.remaining, query.scope),
        };
    }
  };

  getRelease: Api["getRelease"] = async (id) => {
    const detail = await this.#inner.getRelease(id);
    this.#details.set(id, detail);
    this.#serverVerdicts.set(detail.release.triageKey, detail.verdict);
    return this.#overlayDetail(detail);
  };

  /** Enrichment sets up the catalogue rather than digs, so it reaches the server. */
  enrichRelease: Api["enrichRelease"] = async (id) => {
    const detail = await this.#inner.enrichRelease(id);
    this.#details.set(id, detail);
    return this.#overlayDetail(detail);
  };

  /** An attached video improves the catalogue, like enrichment, so it reaches the server. */
  attachVideo: Api["attachVideo"] = async (releaseId, url) => {
    const detail = await this.#inner.attachVideo(releaseId, url);
    this.#details.set(releaseId, detail);
    // As on the server, a new video sends a record marked no audio back to the queue.
    const key = detail.release.triageKey;
    if (this.#verdicts.get(key)?.verdict.status === "no_audio") this.#verdicts.delete(key);
    return this.#overlayDetail(detail);
  };

  putReleaseNote: Api["putReleaseNote"] = async (id, notes) => {
    this.#notes.set(id, notes);
    return { notes };
  };

  postVerdict: Api["postVerdict"] = async (input) => {
    const inputVerdict = VerdictInputSchema.parse(input);
    const existing = this.#verdicts.get(inputVerdict.key);
    const verdict: Verdict = {
      key: inputVerdict.key,
      status: inputVerdict.status,
      source: inputVerdict.source,
      releaseId: inputVerdict.releaseId ?? null,
      decidedAt: inputVerdict.decidedAt ?? this.#now().toISOString(),
    };
    this.#verdicts.set(inputVerdict.key, {
      verdict,
      base: existing ? existing.base : this.#serverVerdicts.get(inputVerdict.key),
    });
    return { ...verdict };
  };

  deleteVerdict: Api["deleteVerdict"] = async (key) => {
    const local = this.#verdicts.get(key);
    if (!local) return { deleted: false, previous: null };
    this.#verdicts.delete(key);
    return { deleted: true, previous: local.verdict };
  };

  postTrackVerdict: Api["postTrackVerdict"] = async (input) => {
    const trackVerdict = TrackVerdictInputSchema.parse(input);
    const key = markKey(trackVerdict.releaseId, trackVerdict.position);
    const previous = this.#savedMark(trackVerdict.releaseId, trackVerdict.position);
    assertTrackIdentity(previous, trackVerdict.tune?.heardKey);
    if (trackVerdict.mark === null) {
      this.#marks.set(key, null);
      return null;
    }

    // As on the server, a mark keeps the tune it was first saved with.
    const tune = this.#trackTune(trackVerdict);
    if (tune && !previous) this.#markTunes.set(key, tune);
    // Omitted notes and moment stay; an unchanged mark keeps its date.
    const mark: TrackVerdict = {
      releaseId: trackVerdict.releaseId,
      position: trackVerdict.position,
      mark: trackVerdict.mark,
      notes: trackVerdict.notes === undefined ? (previous?.notes ?? null) : trackVerdict.notes,
      decidedAt:
        previous?.mark === trackVerdict.mark ? previous.decidedAt : this.#now().toISOString(),
      heardKey: previous?.heardKey ?? tune?.heardKey ?? null,
      ...markMoment(trackVerdict, previous),
    };
    this.#marks.set(key, mark);
    return { ...mark };
  };

  /** The tune the input names, else the one the tracklist has at the position. */
  #trackTune(input: TrackVerdictInput): TuneSnapshot | undefined {
    return (
      input.tune ??
      this.#details.get(input.releaseId)?.tracks.find((track) => track.position === input.position)
    );
  }

  #savedMark(releaseId: number, position: string): TrackVerdict | null {
    const local = this.#marks.get(markKey(releaseId, position));
    if (local !== undefined) return local;
    const saved = this.#details.get(releaseId)?.trackVerdicts;
    return saved?.find((trackVerdict) => trackVerdict.position === position) ?? null;
  }

  getTrackMarks: Api["getTrackMarks"] = async () => {
    const response = await this.#inner.getTrackMarks();
    const items: MarkedTrack[] = [];
    for (const item of response.items) {
      if (item.release && item.onWantlist) this.#serverWantlist.add(item.release.triageKey);
      if (this.#marks.has(markKey(item.mark.releaseId, item.mark.position))) continue;
      items.push({
        ...item,
        onWantlist: this.#isOnWantlist(item.release, item.onWantlist ?? false),
        verdict: this.#localVerdict(item.release) ?? item.verdict,
      });
    }
    for (const mark of this.#marks.values()) if (mark) items.push(this.#markedTrack(mark));
    items.sort((left, right) => right.mark.decidedAt.localeCompare(left.mark.decidedAt));
    return { items };
  };

  #markedTrack(mark: TrackVerdict): MarkedTrack {
    const detail = this.#details.get(mark.releaseId);
    const track = detail?.tracks.find((candidate) => isMarkedTrack(candidate, mark));
    const tune = this.#markTunes.get(markKey(mark.releaseId, mark.position)) ?? track;
    const release = detail
      ? queueItemFromDetail(detail, detail.videos.length)
      : (this.#releases.get(mark.releaseId) ?? null);
    const key = release?.triageKey;
    const serverVerdict = key === undefined ? null : (this.#serverVerdicts.get(key) ?? null);
    const onServerWantlist = key !== undefined && this.#serverWantlist.has(key);
    return {
      mark: { ...mark },
      onWantlist: this.#isOnWantlist(release, onServerWantlist),
      tracklistChanged: !track,
      track: tune
        ? {
            artistDisplay: tune.artistDisplay,
            title: tune.title,
            durationSeconds: track?.durationSeconds ?? null,
          }
        : null,
      release,
      verdict: this.#localVerdict(release) ?? serverVerdict,
    };
  }

  #localVerdict(release: QueueItem | null): Verdict | null {
    return release ? (this.#verdicts.get(release.triageKey)?.verdict ?? null) : null;
  }

  postListenLog: Api["postListenLog"] = async (input) => {
    const log = ListenLogInputSchema.parse(input);
    this.#listenSeq += 1;
    const position = log.position ?? null;
    const track =
      position === null || position === "" || !log.heard
        ? undefined
        : this.#details.get(log.releaseId)?.tracks.find((track) => track.position === position);
    if (track && !track.heard) this.#heard.add(track.heardKey);
    return { id: this.#listenSeq, heardKey: track?.heardKey ?? null };
  };

  /**
   * The server's Twelves records with this sandbox's verdicts, wantlist changes, list reads and
   * notes laid over them, and the records only this sandbox put on the shelves.
   */
  getTwelves: Api["getTwelves"] = async (query = {}) => {
    const response = await this.#inner.getTwelves(query);
    for (const item of response.items) this.#learnTwelvesItem(item);
    const server = new Map(response.items.map((item) => [item.key, item]));
    const listed = query.status ? [] : [...this.#listed.keys()];
    const keys = new Set([...server.keys(), ...this.#verdicts.keys(), ...listed]);

    const items: TwelvesItem[] = [];
    for (const key of keys) {
      const item = this.#twelvesItem(key, server.get(key) ?? null);
      if (this.#onShelves(item, query.status ?? null)) items.push(item);
    }
    items.sort((left, right) => right.since.localeCompare(left.since));
    return { items };
  };

  #learnTwelvesItem(item: TwelvesItem): void {
    if (item.verdict) this.#serverVerdicts.set(item.key, item.verdict);
    if (item.release) this.#rememberRelease(item.release);
    if (item.membership.onWantlist) this.#serverWantlist.add(item.key);
    else this.#serverWantlist.delete(item.key);
    if (item.membership.onList) this.#serverListed.add(item.key);
  }

  #twelvesItem(key: string, server: TwelvesItem | null): TwelvesItem {
    const local = this.#verdicts.get(key);
    const release = this.#twelvesRelease(key, server, local);
    return {
      key,
      verdict: local ? local.verdict : (server?.verdict ?? null),
      release,
      membership: this.#membership(key, server?.membership ?? null),
      since: local?.verdict.decidedAt ?? server?.since ?? this.#now().toISOString(),
      note: this.#noteOf(release, server?.note ?? null),
      pressingNotes: server?.pressingNotes ?? [],
    };
  }

  #twelvesRelease(
    key: string,
    server: TwelvesItem | null,
    local: LocalVerdict | undefined,
  ): QueueItem | null {
    if (server?.release) return server.release;
    const judged = local ? this.#releaseFor(local.verdict) : null;
    return judged ?? this.#listed.get(key) ?? null;
  }

  /** A note written in this sandbox wins over the server's. */
  #noteOf(release: QueueItem | null, onServer: string | null): string | null {
    if (release === null || !this.#notes.has(release.id)) return onServer;
    return this.#notes.get(release.id) ?? null;
  }

  #membership(key: string, onServer: RecordMembership | null): RecordMembership {
    return {
      owned: onServer?.owned ?? false,
      onWantlist: this.#wantlist.get(key) ?? onServer?.onWantlist ?? false,
      onList: this.#listed.has(key) || (onServer?.onList ?? false),
    };
  }

  /** With statuses, records with one of those verdicts; else every record Twelves shelves. */
  #onShelves(item: TwelvesItem, statuses: VerdictStatus[] | null): boolean {
    const status = item.verdict?.status;
    if (statuses !== null) return status !== undefined && statuses.includes(status);
    const { owned, onWantlist, onList } = item.membership;
    return (
      (status !== undefined && TWELVES_STATUSES.includes(status)) || owned || onWantlist || onList
    );
  }

  getStats: Api["getStats"] = async (query = {}) => {
    const [stats, config] = await Promise.all([
      this.#inner.getStats(query),
      this.#inner.getSettings(),
    ]);
    this.#skipHistory = config.filters.skipHistory;
    const counts = { ...stats.verdicts };
    for (const { verdict, base } of this.#verdicts.values()) {
      counts[verdict.status] += 1;
      if (base) counts[base.status] -= 1;
    }
    const remaining = this.#remainingAfterLocal(stats.remaining);
    const scopeRemaining = query.scope
      ? this.#remainingAfterLocal(stats.scopeRemaining ?? 0, query.scope)
      : null;
    const times: string[] = [];
    for (const { verdict } of this.#verdicts.values())
      if (isTriageSource(verdict.source)) times.push(verdict.decidedAt);
    times.sort();
    const local = rateSummary(times, remaining);
    const serverRate = stats.rate.verdictsPerHour;
    const rate =
      local.verdictsPerHour !== null
        ? local
        : {
            ...stats.rate,
            etaHours: serverRate === null ? null : Math.round((remaining / serverRate) * 10) / 10,
          };
    return {
      ...stats,
      dug: Math.max(0, stats.dug + this.#dugDelta()),
      verdicts: counts,
      remaining,
      scopeRemaining,
      rate,
      heardTracks: stats.heardTracks + this.#heard.size,
    };
  };

  searchScopes: Api["searchScopes"] = (text) => this.#inner.searchScopes(text);

  getSettings: Api["getSettings"] = () => this.#inner.getSettings();

  putSettings: Api["putSettings"] = (config) => this.#inner.putSettings(config);

  startDumpDownload: Api["startDumpDownload"] = () => this.#inner.startDumpDownload();
  startDumpLoad: Api["startDumpLoad"] = (input) => this.#inner.startDumpLoad(input);
  startDumpUpdate: Api["startDumpUpdate"] = () => this.#inner.startDumpUpdate();
  getDumps: Api["getDumps"] = () => this.#inner.getDumps();
  deleteDump: Api["deleteDump"] = (name) => this.#inner.deleteDump(name);

  startImport: Api["startImport"] = async (kind, input = {}) => {
    if (kind !== "list") return this.#inner.startImport(kind, input);
    // Reading the list is not a write, so the sandbox reads the real list.
    const listId =
      ImportJobInputSchema.parse(input).listId ??
      (await this.#inner.getSettings()).discogs.maybeListId;
    if (listId === null) throw new Error("Choose your Discogs Maybe list in Settings first");
    return this.#startListImport(listId);
  };

  getJobs: Api["getJobs"] = async () => {
    const response = await this.#inner.getJobs();
    const all = [...[...this.#jobs.values()].map((f) => ({ ...f.job })), ...response.jobs];
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { jobs: all };
  };

  getJob: Api["getJob"] = async (id) => {
    const fake = this.#jobs.get(id);
    return fake ? { ...fake.job } : this.#inner.getJob(id);
  };

  cancelJob: Api["cancelJob"] = async (id) => {
    const fake = this.#jobs.get(id);
    // The list read is a single request; there is nothing to stop halfway.
    return fake ? { cancelled: false, job: { ...fake.job } } : this.#inner.cancelJob(id);
  };

  getDiscogsAccount: Api["getDiscogsAccount"] = () => this.#inner.getDiscogsAccount();
  setDiscogsToken: Api["setDiscogsToken"] = (token) => this.#inner.setDiscogsToken(token);

  getDiscogsLists: Api["getDiscogsLists"] = () => this.#inner.getDiscogsLists();

  getDiscogsList: Api["getDiscogsList"] = (id) => this.#inner.getDiscogsList(id);

  backupNow: Api["backupNow"] = () => this.#inner.backupNow();

  getBackups: Api["getBackups"] = () => this.#inner.getBackups();

  getSetup: Api["getSetup"] = () => this.#inner.getSetup();

  getStyles: Api["getStyles"] = () => this.#inner.getStyles();

  getDiscogsProfile: Api["getDiscogsProfile"] = () => this.#inner.getDiscogsProfile();

  forgetFirstLoad: Api["forgetFirstLoad"] = () => this.#inner.forgetFirstLoad();

  exportUrl: Api["exportUrl"] = (file) => this.#inner.exportUrl(file);

  pushToWantlist: Api["pushToWantlist"] = (releaseId) => this.#fakeWantlistWrite(releaseId, true);

  removeFromWantlist: Api["removeFromWantlist"] = (releaseId) =>
    this.#fakeWantlistWrite(releaseId, false);
}

/** The moment a mark write sends, or the saved one when it sends none. */
function markMoment(
  input: { videoId?: string; atSeconds?: number },
  previous: TrackVerdict | null,
): Pick<TrackVerdict, "videoId" | "atSeconds"> {
  if (input.videoId === undefined || input.atSeconds === undefined)
    return { videoId: previous?.videoId ?? null, atSeconds: previous?.atSeconds ?? null };
  return { videoId: input.videoId, atSeconds: input.atSeconds };
}
