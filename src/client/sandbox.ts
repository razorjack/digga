import {
  ImportJobInputSchema,
  ListenLogInputSchema,
  TrackVerdictInputSchema,
  VerdictInputSchema,
  type DiscogsListEntry,
  type MarkedTrack,
  type QueueItem,
  type ReleaseDetail,
  type TrackDetail,
  type TwelvesItem,
} from "../shared/api.ts";
import { formatSummary } from "../shared/formats.ts";
import { rateSummary } from "../shared/rate.ts";
import { type ScopeRef, scopeKey } from "../shared/scope.ts";
import type { Job, TrackVerdict, Verdict } from "../shared/types.ts";
import { isTriageSource, seedRank } from "../shared/verdict-rank.ts";
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

function queueItemFromDetail(detail: ReleaseDetail, videoCount: number): QueueItem {
  const release = detail.release;
  return {
    id: release.id,
    triageKey: release.triageKey,
    masterId: release.masterId,
    title: release.title,
    artistDisplay: release.artistDisplay,
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

  #listenSeq = 0;

  #jobSeq = 0;

  #rememberRelease = (item: QueueItem) => {
    this.#releases.set(item.id, item);
  };

  #overlayTrack = (track: TrackDetail): TrackDetail => {
    const mark = this.#marks.get(markKey(track.releaseId, track.position));
    return {
      ...track,
      heard: track.heard || this.#heard.has(track.heardKey),
      mark: mark === undefined ? track.mark : (mark?.mark ?? null),
    };
  };

  #overlayDetail = (detail: ReleaseDetail): ReleaseDetail => {
    const tracks = detail.tracks.map(this.#overlayTrack);
    const trackVerdicts = new Map(
      detail.trackVerdicts.map((trackVerdict) => [trackVerdict.position, trackVerdict]),
    );
    for (const [key, trackVerdict] of this.#marks) {
      const [releaseId, position] = key.split("\n") as [string, string];
      if (Number(releaseId) !== detail.release.id) continue;
      if (trackVerdict) trackVerdicts.set(position, trackVerdict);
      else trackVerdicts.delete(position);
    }
    return {
      ...detail,
      tracks,
      trackVerdicts: [...trackVerdicts.values()],
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

  /** Local verdicts on previously undecided keys reduce the remaining count. */
  #newlyDecided = () =>
    [...this.#verdicts.values()].filter((localVerdict) => localVerdict.base === null).length;

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
    const decided = keys.filter((key) => this.#verdicts.get(key)?.base === null).length;
    return Math.max(0, remaining - decided);
  };

  #dugDelta = () => {
    let delta = 0;
    for (const { verdict, base } of this.#verdicts.values()) {
      const wasDug = base ? isTriageSource(base.source) : false;
      if (isTriageSource(verdict.source) && !wasDug) delta += 1;
      if (!isTriageSource(verdict.source) && wasDug) delta -= 1;
    }
    return delta;
  };

  /** Uses the real list as read-only input and applies seed precedence in memory. */
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
        verdictsWritten: written,
      },
      finishedAt: this.#now().toISOString(),
    };
  };

  #applyListEntry(entry: DiscogsListEntry): boolean {
    if (entry.release) this.#rememberRelease(entry.release);
    if (!this.#serverVerdicts.has(entry.key)) this.#serverVerdicts.set(entry.key, entry.verdict);
    const previous =
      this.#verdicts.get(entry.key)?.verdict ?? this.#serverVerdicts.get(entry.key) ?? null;
    const seed: Verdict = {
      key: entry.key,
      status: "maybe",
      source: "seed:list",
      notes: entry.comment ?? previous?.notes ?? null,
      releaseId: entry.release?.id ?? null,
      decidedAt: this.#now().toISOString(),
    };
    if (!shouldApplyListSeed(seed, previous)) return false;
    const existing = this.#verdicts.get(entry.key);
    this.#verdicts.set(entry.key, {
      verdict: seed,
      base: existing ? existing.base : entry.verdict,
    });
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
        progress: { page: 1, pages: 1, processed: 0, stubs: 0, verdictsWritten: 0 },
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

  getQueue: Api["getQueue"] = async (query = {}) => {
    const want = query.limit ?? (await this.#inner.getSettings()).queue.limit;
    // Locally decided keys are still undecided on the server, so page past them.
    const limit = Math.min(this.#queuePageLimit, want + this.#verdicts.size);
    const inScope = query.scope ? this.#keysInScope(query.scope) : null;
    const items: QueueItem[] = [];
    let offset = query.offset ?? 0;
    for (;;) {
      const response = await this.#inner.getQueue({ ...query, limit, offset });
      for (const item of response.items) {
        this.#rememberRelease(item);
        inScope?.add(item.triageKey);
        if (!this.#serverVerdicts.has(item.triageKey))
          this.#serverVerdicts.set(item.triageKey, null);
        if (!this.#verdicts.has(item.triageKey) && items.length < want) items.push(item);
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

  postVerdict: Api["postVerdict"] = async (input) => {
    const inputVerdict = VerdictInputSchema.parse(input);
    const verdict: Verdict = {
      key: inputVerdict.key,
      status: inputVerdict.status,
      source: inputVerdict.source,
      notes: inputVerdict.notes ?? null,
      releaseId: inputVerdict.releaseId ?? null,
      decidedAt: inputVerdict.decidedAt ?? this.#now().toISOString(),
    };
    const existing = this.#verdicts.get(inputVerdict.key);
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
    if (trackVerdict.mark === null) {
      this.#marks.set(key, null);
      return null;
    }
    // As on the server: omitted notes stay, and an unchanged mark keeps its date.
    const previous = this.#savedMark(trackVerdict.releaseId, trackVerdict.position);
    const mark: TrackVerdict = {
      releaseId: trackVerdict.releaseId,
      position: trackVerdict.position,
      mark: trackVerdict.mark,
      notes: trackVerdict.notes === undefined ? (previous?.notes ?? null) : trackVerdict.notes,
      decidedAt:
        previous?.mark === trackVerdict.mark ? previous.decidedAt : this.#now().toISOString(),
    };
    this.#marks.set(key, mark);
    return { ...mark };
  };

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
      if (this.#marks.has(markKey(item.mark.releaseId, item.mark.position))) continue;
      items.push({ ...item, verdict: this.#localVerdict(item.release) ?? item.verdict });
    }
    for (const mark of this.#marks.values()) if (mark) items.push(this.#markedTrack(mark));
    items.sort((left, right) => right.mark.decidedAt.localeCompare(left.mark.decidedAt));
    return { items };
  };

  #markedTrack(mark: TrackVerdict): MarkedTrack {
    const detail = this.#details.get(mark.releaseId);
    const track = detail?.tracks.find((candidate) => candidate.position === mark.position);
    const release = detail
      ? queueItemFromDetail(detail, detail.videos.length)
      : (this.#releases.get(mark.releaseId) ?? null);
    const serverVerdict = release ? (this.#serverVerdicts.get(release.triageKey) ?? null) : null;
    return {
      mark: { ...mark },
      track: track
        ? {
            artistDisplay: track.artistDisplay,
            title: track.title,
            durationSeconds: track.durationSeconds,
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
      position === null || position === ""
        ? undefined
        : this.#details.get(log.releaseId)?.tracks.find((track) => track.position === position);
    if (track && !track.heard) this.#heard.add(track.heardKey);
    return { id: this.#listenSeq, heardKey: track?.heardKey ?? null };
  };

  getTwelves: Api["getTwelves"] = async (query = {}) => {
    const response = await this.#inner.getTwelves(query);
    for (const item of response.items) {
      this.#serverVerdicts.set(item.verdict.key, item.verdict);
      if (item.release) this.#rememberRelease(item.release);
    }
    const serverWantlist = new Set(
      response.items.filter((i) => i.onWantlist).map((i) => i.verdict.key),
    );
    const onWantlist = (key: string) => this.#wantlist.get(key) ?? serverWantlist.has(key);
    const local: TwelvesItem[] = [...this.#verdicts.values()]
      .filter((localVerdict) => response.statuses.includes(localVerdict.verdict.status))
      .map((localVerdict) => ({
        verdict: { ...localVerdict.verdict },
        release: this.#releaseFor(localVerdict.verdict),
        onWantlist: onWantlist(localVerdict.verdict.key),
      }));
    const items = [
      ...local,
      ...response.items
        .filter((i) => !this.#verdicts.has(i.verdict.key))
        .map((i) => ({ ...i, onWantlist: onWantlist(i.verdict.key) })),
    ];
    items.sort((a, b) => b.verdict.decidedAt.localeCompare(a.verdict.decidedAt));
    return { ...response, items };
  };

  getStats: Api["getStats"] = async (query = {}) => {
    const stats = await this.#inner.getStats(query);
    const counts = { ...stats.verdicts };
    for (const { verdict, base } of this.#verdicts.values()) {
      counts[verdict.status] += 1;
      if (base) counts[base.status] -= 1;
    }
    const remaining = this.#remainingAfterLocal(stats.remaining);
    const scopeRemaining = query.scope
      ? this.#remainingAfterLocal(stats.scopeRemaining ?? 0, query.scope)
      : null;
    const times = [...this.#verdicts.values()]
      .filter(
        (localVerdict) =>
          localVerdict.verdict.source === "triage" || localVerdict.verdict.source === "manual",
      )
      .map((localVerdict) => localVerdict.verdict.decidedAt)
      .sort();
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

function shouldApplyListSeed(seed: Verdict, previous: Verdict | null): boolean {
  if (previous?.status === "maybe" && previous.source === "seed:list") return false;
  return previous === null || seedRank(seed) >= seedRank(previous);
}
