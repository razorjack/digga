import { z } from "zod";
import {
  FiltersSchema,
  QUEUE_STRATEGIES,
  type Config,
  type Filters,
  type QueueStrategy,
} from "./config.ts";
import { TRIAGE_KEY_PATTERN } from "./triage-key.ts";
import {
  TRACK_MARKS,
  VERDICT_SOURCES,
  VERDICT_STATUSES,
  type Job,
  type ReleaseRecord,
  type TrackMark,
  type TrackRecord,
  type TrackVerdict,
  type Verdict,
  type VerdictStatus,
  type VideoRecord,
} from "./types.ts";

/** Every /api endpoint's request and response shape lives here, shared by server and client. */

export interface ApiError {
  error: string;
  issues?: unknown;
}

/**
 * Query-time filters as a JSON query parameter. They replace the configured filters for one
 * read, so a client can preview filters it has not saved.
 */
const FiltersParamSchema = z
  .string()
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "filters must be a JSON object" });
      return z.NEVER;
    }
  })
  .pipe(FiltersSchema);

/** Serialises filters for FiltersParamSchema. */
export function filtersParam(filters: Filters | undefined): string | undefined {
  return filters === undefined ? undefined : JSON.stringify(filters);
}

// GET /api/queue?strategy&limit&offset&seed&filters
export const QueueQuerySchema = z.object({
  strategy: z.enum(QUEUE_STRATEGIES).optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  seed: z.coerce.number().int().optional(),
  filters: FiltersParamSchema.optional(),
});
export type QueueQuery = z.infer<typeof QueueQuerySchema>;

export interface QueueItem {
  id: number;
  triageKey: string;
  masterId: number | null;
  title: string;
  artistDisplay: string;
  labelName: string | null;
  catno: string | null;
  year: number | null;
  country: string | null;
  formatSummary: string;
  styles: string[];
  videoCount: number;
  communityWant: number | null;
  communityHave: number | null;
  numForSale: number | null;
  lowestPrice: number | null;
  currency: string | null;
  enrichedAt: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  /** Triage keys left in the filtered universe without a verdict. */
  remaining: number;
  strategy: QueueStrategy;
  seed: number | null;
  filters: Filters;
}

// GET /api/releases/:id
export interface TrackDetail extends TrackRecord {
  heard: boolean;
  hasVideo: boolean;
  mark: TrackMark | null;
}

export interface ReleaseSibling {
  id: number;
  title: string;
  year: number | null;
  country: string | null;
  formatSummary: string;
  labelName: string | null;
  catno: string | null;
  isMainRelease: boolean;
  videoCount: number;
  inUniverse: boolean;
}

export interface ReleaseDetail {
  release: ReleaseRecord;
  tracks: TrackDetail[];
  videos: VideoRecord[];
  verdict: Verdict | null;
  trackVerdicts: TrackVerdict[];
  /** Other releases sharing the master, excluding this one. */
  siblings: ReleaseSibling[];
}

// POST /api/verdicts
export const VerdictInputSchema = z.object({
  key: z.string().regex(TRIAGE_KEY_PATTERN),
  status: z.enum(VERDICT_STATUSES),
  source: z.enum(VERDICT_SOURCES).default("triage"),
  notes: z.string().max(4000).nullable().optional(),
  releaseId: z.number().int().positive().nullable().optional(),
});
export type VerdictInput = z.input<typeof VerdictInputSchema>;
export type VerdictResponse = Verdict;

// DELETE /api/verdicts/:key
export interface DeleteVerdictResponse {
  deleted: boolean;
  previous: Verdict | null;
}

// POST /api/track-verdicts
export const TrackVerdictInputSchema = z.object({
  releaseId: z.number().int().positive(),
  position: z.string().min(1),
  mark: z.enum(TRACK_MARKS).nullable(),
  notes: z.string().max(4000).nullable().optional(),
});
export type TrackVerdictInput = z.infer<typeof TrackVerdictInputSchema>;
export type TrackVerdictResponse = TrackVerdict | null;

// POST /api/listen-log
export const ListenLogInputSchema = z.object({
  releaseId: z.number().int().positive(),
  position: z.string().nullable().optional(),
  videoId: z.string().min(1),
  seconds: z.number().nonnegative(),
});
export type ListenLogInput = z.infer<typeof ListenLogInputSchema>;
export interface ListenLogResponse {
  id: number;
  heardKey: string | null;
}

// GET /api/twelves?status=accepted,wantlist
export const TwelvesQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) =>
      s ? s.split(",").map((x) => x.trim()) : ["accepted", "wantlist", "collection"],
    )
    .pipe(z.array(z.enum(VERDICT_STATUSES)).min(1)),
  applyFilters: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
});
export type TwelvesQuery = z.infer<typeof TwelvesQuerySchema>;
export type TwelvesQueryInput = z.input<typeof TwelvesQuerySchema>;

export interface TwelvesItem {
  verdict: Verdict;
  release: QueueItem | null;
}

export interface TwelvesResponse {
  items: TwelvesItem[];
  statuses: VerdictStatus[];
}

// GET /api/stats?filters
export const StatsQuerySchema = z.object({
  filters: FiltersParamSchema.optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export interface Stats {
  /** Releases dug: verdicts made in Digga (triage or manual), not seeds. */
  dug: number;
  universe: {
    releases: number;
    keys: number;
    filteredKeys: number;
  };
  verdicts: Record<VerdictStatus, number>;
  remaining: number;
  rate: {
    verdictsPerHour: number | null;
    sessions: number;
    etaHours: number | null;
  };
  dump: {
    date: string | null;
    loadedAt: string | null;
  };
  heardTracks: number;
}

// GET|PUT /api/settings
export type SettingsResponse = Config;

// POST /api/jobs/enrich
export const EnrichJobInputSchema = z.object({
  ahead: z.number().int().positive().max(5000).default(200),
});
export type EnrichJobInput = z.input<typeof EnrichJobInputSchema>;

// POST /api/jobs/dump-load
export const DumpLoadJobInputSchema = z.object({
  file: z.string().min(1),
  limit: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  labelsFile: z.string().optional(),
  artistsFile: z.string().optional(),
});
export type DumpLoadJobInput = z.input<typeof DumpLoadJobInputSchema>;

// POST /api/jobs/import/:kind
export const IMPORT_KINDS = ["collection", "wantlist", "history", "list"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const BROWSERS = ["brave", "chrome", "firefox"] as const;
export type Browser = (typeof BROWSERS)[number];
export const ImportJobInputSchema = z.object({
  browser: z.enum(BROWSERS).optional(),
  path: z.string().optional(),
  /** List import: the Discogs list to read; defaults to discogs.maybeListId. */
  listId: z.number().int().positive().optional(),
});
export type ImportJobInput = z.infer<typeof ImportJobInputSchema>;

export type JobResponse = Job;
export interface JobsResponse {
  jobs: Job[];
}

// POST /api/discogs/wantlist/:id (501 until session 3)
export const WantlistPushInputSchema = z.object({
  notes: z.string().max(255).optional(),
  rating: z.number().int().min(0).max(5).optional(),
});
export type WantlistPushInput = z.infer<typeof WantlistPushInputSchema>;
export interface WantlistPushResponse {
  releaseId: number;
  ok: boolean;
}

// GET /api/discogs/lists (the configured user's lists, private ones included with a token)
export interface DiscogsListSummary {
  id: number;
  name: string;
  public: boolean;
}
export interface DiscogsListsResponse {
  lists: DiscogsListSummary[];
}

// GET /api/discogs/lists/:id (read only: nothing is written)
export interface DiscogsListEntry {
  type: "release" | "master";
  discogsId: number;
  /** Triage key the entry maps to. */
  key: string;
  displayTitle: string;
  comment: string | null;
  /** The release shown for the entry: from the dump, or built from the API when outside it. */
  release: QueueItem | null;
  /** Digga's verdict for the key before the list is applied. */
  verdict: Verdict | null;
}
export interface DiscogsListResponse {
  id: number;
  name: string;
  entries: DiscogsListEntry[];
}
