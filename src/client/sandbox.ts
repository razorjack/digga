import {
  DumpLoadJobInputSchema,
  EnrichJobInputSchema,
  IMPORT_KINDS,
  ImportJobInputSchema,
  ListenLogInputSchema,
  TrackVerdictInputSchema,
  VerdictInputSchema,
  WantlistPushInputSchema,
  type QueueItem,
  type ReleaseDetail,
  type TrackDetail,
  type TwelvesItem,
} from "../shared/api.ts";
import { type Config, ConfigSchema } from "../shared/config.ts";
import { formatSummary } from "../shared/formats.ts";
import { rateSummary } from "../shared/rate.ts";
import type { Job, JobType, TrackVerdict, Verdict } from "../shared/types.ts";
import { isTriageSource, seedRank } from "../shared/verdict-rank.ts";
import type { Api } from "./api.ts";

export interface SandboxOptions {
  now?: () => Date;
  /** Simulated round trip of a Discogs wantlist push, so the UI shows its pending state. */
  pushDelayMs?: number;
  /** Interval between simulated job progress updates; a job finishes after JOB_STEPS ticks. */
  jobTickMs?: number;
  /** Largest queue page requested from the server (its own cap is 5000). */
  queuePageLimit?: number;
}

interface LocalVerdict {
  verdict: Verdict;
  /** The server's verdict for the key: null when it was undecided there, undefined when unknown. */
  base: Verdict | null | undefined;
}

interface FakeJob {
  job: Job;
  step: number;
  progress: (step: number) => unknown;
  timer: ReturnType<typeof setTimeout> | null;
}

export const JOB_STEPS = 24;
const MAX_QUEUE_LIMIT = 5000;

const markKey = (releaseId: number, position: string) => `${releaseId}\n${position}`;

function queueItemFromDetail(d: ReleaseDetail, videoCount: number): QueueItem {
  const r = d.release;
  return {
    id: r.id,
    triageKey: r.triageKey,
    masterId: r.masterId,
    title: r.title,
    artistDisplay: r.artistDisplay,
    labelName: r.labelName,
    catno: r.catno,
    year: r.year,
    country: r.country,
    formatSummary: formatSummary(r.formats),
    styles: r.styles,
    videoCount,
    communityWant: r.snapshot.communityWant,
    communityHave: r.snapshot.communityHave,
    numForSale: r.snapshot.numForSale,
    lowestPrice: r.snapshot.lowestPrice,
    currency: r.snapshot.currency,
    enrichedAt: r.snapshot.enrichedAt,
  };
}

function jobProgressPlan(type: JobType, size: number): (step: number) => unknown {
  const share = (step: number, total: number) => Math.round((total * step) / JOB_STEPS);
  switch (type) {
    case "enrich":
      return (step) => ({
        done: share(step, size),
        total: size,
        currentReleaseId: null,
        failed: 0,
      });
    case "import_collection":
    case "import_wantlist":
      return (step) => ({
        page: Math.max(1, Math.ceil((3 * step) / JOB_STEPS)),
        pages: 3,
        processed: share(step, size),
        stubs: 0,
        verdictsWritten: 0,
      });
    case "import_list":
      return (step) => ({
        page: 1,
        pages: 1,
        processed: share(step, size),
        stubs: 0,
        verdictsWritten: 0,
      });
    case "import_history":
      return (step) => ({
        files: 1,
        urls: share(step, 40_000),
        discogsUrls: share(step, 1_200),
        keys: share(step, 800),
        verdictsWritten: 0,
      });
    case "dump_load":
      return (step) => ({
        phase: step >= JOB_STEPS ? "done" : "scanning",
        scanned: share(step, size),
        matched: share(step, Math.round(size / 270)),
        upserted: 0,
        elapsedSeconds: step,
      });
  }
}

/**
 * An Api that forwards every read to `inner` and fakes every write in memory. Nothing reaches
 * the database, the config file or Discogs; a reload starts from the server's state again.
 * Reads are overlaid with the fake writes, so the queue, counters, Twelves, heard tracks and
 * undo behave as if the writes had happened.
 */
export function createSandboxApi(inner: Api, opts: SandboxOptions = {}): Api {
  const now = opts.now ?? (() => new Date());
  const pushDelayMs = opts.pushDelayMs ?? 350;
  const jobTickMs = opts.jobTickMs ?? 250;
  const queuePageLimit = opts.queuePageLimit ?? MAX_QUEUE_LIMIT;

  const verdicts = new Map<string, LocalVerdict>();
  /** Server verdicts seen in earlier reads; null for keys the queue returned as undecided. */
  const serverVerdicts = new Map<string, Verdict | null>();
  const marks = new Map<string, TrackVerdict | null>();
  /** Heard keys first heard in this sandbox, i.e. not heard according to the server. */
  const heard = new Set<string>();
  const releases = new Map<number, QueueItem>();
  const details = new Map<number, ReleaseDetail>();
  const jobs = new Map<string, FakeJob>();
  let settings: Config | null = null;
  let serverConfig: Promise<Config> | null = null;
  let listenSeq = 0;
  let jobSeq = 0;

  const config = (): Promise<Config> => {
    if (settings) return Promise.resolve(settings);
    serverConfig ??= inner.getSettings();
    return serverConfig;
  };

  const rememberRelease = (item: QueueItem) => {
    releases.set(item.id, item);
  };

  const overlayTrack = (t: TrackDetail): TrackDetail => {
    const mark = marks.get(markKey(t.releaseId, t.position));
    return {
      ...t,
      heard: t.heard || heard.has(t.heardKey),
      mark: mark === undefined ? t.mark : (mark?.mark ?? null),
    };
  };

  const overlayDetail = (d: ReleaseDetail): ReleaseDetail => {
    const tracks = d.tracks.map(overlayTrack);
    const trackVerdicts = new Map(d.trackVerdicts.map((tv) => [tv.position, tv]));
    for (const [key, tv] of marks) {
      const [releaseId, position] = key.split("\n") as [string, string];
      if (Number(releaseId) !== d.release.id) continue;
      if (tv) trackVerdicts.set(position, tv);
      else trackVerdicts.delete(position);
    }
    return {
      ...d,
      tracks,
      trackVerdicts: [...trackVerdicts.values()],
      verdict: verdicts.get(d.release.triageKey)?.verdict ?? d.verdict,
    };
  };

  const releaseFor = (v: Verdict): QueueItem | null => {
    if (v.releaseId === null) return null;
    const cached = releases.get(v.releaseId);
    if (cached) return cached;
    const d = details.get(v.releaseId);
    return d ? queueItemFromDetail(d, d.videos.length) : null;
  };

  /** Local verdicts on keys the server has no verdict for: they shrink "remaining". */
  const newlyDecided = () => [...verdicts.values()].filter((l) => l.base === null).length;

  /** How the local verdicts change the server's "dug" count (decisions made in Digga). */
  const dugDelta = () => {
    let delta = 0;
    for (const { verdict, base } of verdicts.values()) {
      const wasDug = base ? isTriageSource(base.source) : false;
      if (isTriageSource(verdict.source) && !wasDug) delta += 1;
      if (!isTriageSource(verdict.source) && wasDug) delta -= 1;
    }
    return delta;
  };

  /** Applies a Discogs list as `maybe` seeds in memory, with the same precedence as the import. */
  const applyListSeeds = async (listId: number, job: FakeJob): Promise<void> => {
    const list = await inner.getDiscogsList(listId);
    let written = 0;
    for (const entry of list.entries) {
      if (entry.release) rememberRelease(entry.release);
      if (!serverVerdicts.has(entry.key)) serverVerdicts.set(entry.key, entry.verdict);
      const previous = verdicts.get(entry.key)?.verdict ?? serverVerdicts.get(entry.key) ?? null;
      const seed: Verdict = {
        key: entry.key,
        status: "maybe",
        source: "seed:list",
        notes: entry.comment ?? previous?.notes ?? null,
        releaseId: entry.release?.id ?? null,
        decidedAt: now().toISOString(),
      };
      if (previous?.status === "maybe" && previous.source === "seed:list") continue;
      if (previous && seedRank(seed) < seedRank(previous)) continue;
      const existing = verdicts.get(entry.key);
      verdicts.set(entry.key, { verdict: seed, base: existing ? existing.base : entry.verdict });
      written += 1;
    }
    job.job = {
      ...job.job,
      status: "done",
      progress: {
        page: 1,
        pages: 1,
        processed: list.entries.length,
        stubs: 0,
        verdictsWritten: written,
      },
      finishedAt: now().toISOString(),
    };
  };

  const startJob = (type: JobType, size: number, run?: (job: FakeJob) => Promise<void>): Job => {
    jobSeq += 1;
    const stamp = now().toISOString();
    const fake: FakeJob = {
      job: {
        id: `sandbox-${jobSeq}`,
        type,
        status: "running",
        progress: null,
        error: null,
        createdAt: stamp,
        startedAt: stamp,
        finishedAt: null,
      },
      step: 0,
      progress: jobProgressPlan(type, size),
      timer: null,
    };
    fake.job.progress = fake.progress(0);
    jobs.set(fake.job.id, fake);
    if (run) {
      // A real read runs instead of the simulated ticks; it finishes the job itself.
      run(fake).catch((e: unknown) => {
        fake.job = {
          ...fake.job,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          finishedAt: now().toISOString(),
        };
      });
      return { ...fake.job };
    }
    const tick = () => {
      fake.step += 1;
      fake.job = { ...fake.job, progress: fake.progress(fake.step) };
      if (fake.step >= JOB_STEPS) {
        fake.job = { ...fake.job, status: "done", finishedAt: now().toISOString() };
        fake.timer = null;
        return;
      }
      fake.timer = setTimeout(tick, jobTickMs);
    };
    fake.timer = setTimeout(tick, jobTickMs);
    return { ...fake.job };
  };

  return {
    mode: "sandbox",

    async getQueue(query = {}) {
      const cfg = await config();
      const want = query.limit ?? cfg.queue.limit;
      // Locally decided keys are still undecided on the server, so page past them.
      const limit = Math.min(queuePageLimit, want + verdicts.size);
      const items: QueueItem[] = [];
      let offset = query.offset ?? 0;
      for (;;) {
        const res = await inner.getQueue({
          ...query,
          strategy: query.strategy ?? (settings ? settings.queue.strategy : undefined),
          filters: query.filters ?? settings?.filters,
          limit,
          offset,
        });
        for (const item of res.items) {
          rememberRelease(item);
          if (!serverVerdicts.has(item.triageKey)) serverVerdicts.set(item.triageKey, null);
          if (!verdicts.has(item.triageKey) && items.length < want) items.push(item);
        }
        offset += res.items.length;
        if (items.length >= want || res.items.length < limit)
          return { ...res, items, remaining: Math.max(0, res.remaining - newlyDecided()) };
      }
    },

    async getRelease(id) {
      const d = await inner.getRelease(id);
      details.set(id, d);
      serverVerdicts.set(d.release.triageKey, d.verdict);
      return overlayDetail(d);
    },

    async postVerdict(input) {
      const v = VerdictInputSchema.parse(input);
      const verdict: Verdict = {
        key: v.key,
        status: v.status,
        source: v.source,
        notes: v.notes ?? null,
        releaseId: v.releaseId ?? null,
        decidedAt: now().toISOString(),
      };
      const existing = verdicts.get(v.key);
      verdicts.set(v.key, {
        verdict,
        base: existing ? existing.base : serverVerdicts.get(v.key),
      });
      return { ...verdict };
    },

    async deleteVerdict(key) {
      const local = verdicts.get(key);
      if (!local) return { deleted: false, previous: null };
      verdicts.delete(key);
      return { deleted: true, previous: local.verdict };
    },

    async postTrackVerdict(input) {
      const tv = TrackVerdictInputSchema.parse(input);
      const key = markKey(tv.releaseId, tv.position);
      if (tv.mark === null) {
        marks.set(key, null);
        return null;
      }
      const mark: TrackVerdict = {
        releaseId: tv.releaseId,
        position: tv.position,
        mark: tv.mark,
        notes: tv.notes ?? null,
        decidedAt: now().toISOString(),
      };
      marks.set(key, mark);
      return { ...mark };
    },

    async postListenLog(input) {
      const log = ListenLogInputSchema.parse(input);
      listenSeq += 1;
      const position = log.position ?? null;
      const track =
        position === null || position === ""
          ? undefined
          : details.get(log.releaseId)?.tracks.find((t) => t.position === position);
      if (track && !track.heard) heard.add(track.heardKey);
      return { id: listenSeq, heardKey: track?.heardKey ?? null };
    },

    async getTwelves(query = {}) {
      const res = await inner.getTwelves(query);
      for (const item of res.items) {
        serverVerdicts.set(item.verdict.key, item.verdict);
        if (item.release) rememberRelease(item.release);
      }
      const local: TwelvesItem[] = [...verdicts.values()]
        .filter((l) => res.statuses.includes(l.verdict.status))
        .map((l) => ({ verdict: { ...l.verdict }, release: releaseFor(l.verdict) }));
      const items = [...local, ...res.items.filter((i) => !verdicts.has(i.verdict.key))];
      items.sort((a, b) => b.verdict.decidedAt.localeCompare(a.verdict.decidedAt));
      return { ...res, items };
    },

    async getStats(query = {}) {
      const stats = await inner.getStats({ filters: query.filters ?? settings?.filters });
      const counts = { ...stats.verdicts };
      for (const { verdict, base } of verdicts.values()) {
        counts[verdict.status] += 1;
        if (base) counts[base.status] -= 1;
      }
      const remaining = Math.max(0, stats.remaining - newlyDecided());
      const times = [...verdicts.values()]
        .filter((l) => l.verdict.source === "triage" || l.verdict.source === "manual")
        .map((l) => l.verdict.decidedAt)
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
        dug: Math.max(0, stats.dug + dugDelta()),
        verdicts: counts,
        remaining,
        rate,
        heardTracks: stats.heardTracks + heard.size,
      };
    },

    async getSettings() {
      return structuredClone(await config());
    },

    async putSettings(next) {
      settings = ConfigSchema.parse(next);
      return structuredClone(settings);
    },

    async startEnrich(input = {}) {
      return startJob("enrich", EnrichJobInputSchema.parse(input).ahead);
    },

    async startDumpLoad(input) {
      const opts = DumpLoadJobInputSchema.parse(input);
      return startJob("dump_load", opts.limit ? opts.limit * 270 : 19_400_000);
    },

    async startImport(kind, input = {}) {
      if (!IMPORT_KINDS.includes(kind)) throw new Error(`Unknown import kind ${String(kind)}`);
      const opts = ImportJobInputSchema.parse(input);
      if (kind === "list") {
        // Reading the list is not a write, so the sandbox reads the real list.
        const listId = opts.listId ?? (await config()).discogs.maybeListId;
        if (listId === null) throw new Error("Choose your Discogs Maybe list in Settings first");
        return startJob("import_list", 0, (job) => applyListSeeds(listId, job));
      }
      return startJob(
        kind === "collection"
          ? "import_collection"
          : kind === "wantlist"
            ? "import_wantlist"
            : "import_history",
        kind === "collection" ? 40 : 250,
      );
    },

    async getJobs() {
      const res = await inner.getJobs();
      const fake = [...jobs.values()].map((f) => ({ ...f.job }));
      const all = [...fake, ...res.jobs];
      all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { jobs: all };
    },

    async getJob(id) {
      const fake = jobs.get(id);
      return fake ? { ...fake.job } : inner.getJob(id);
    },

    async cancelJob(id) {
      const fake = jobs.get(id);
      if (!fake) return { cancelled: false, job: await inner.getJob(id) };
      if (fake.job.status !== "running") return { cancelled: false, job: { ...fake.job } };
      if (fake.timer) clearTimeout(fake.timer);
      fake.timer = null;
      fake.job = { ...fake.job, status: "cancelled", finishedAt: now().toISOString() };
      return { cancelled: true, job: { ...fake.job } };
    },

    getDiscogsLists: () => inner.getDiscogsLists(),

    getDiscogsList: (id) => inner.getDiscogsList(id),

    async pushToWantlist(releaseId, input = {}) {
      WantlistPushInputSchema.parse(input);
      await new Promise((resolve) => setTimeout(resolve, pushDelayMs));
      return { releaseId, ok: true };
    },
  };
}
