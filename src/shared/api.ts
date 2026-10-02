import { z } from "zod";
import {
  FiltersSchema,
  QUEUE_STRATEGIES,
  type Config,
  type Filters,
  type QueueStrategy,
} from "./config.ts";
import { type QueueScope, ScopeParamSchema } from "./scope.ts";
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
  type VerdictSource,
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
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
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

// GET /api/queue?strategy&limit&offset&seed&filters&scope
export const QueueQuerySchema = z.object({
  strategy: z.enum(QUEUE_STRATEGIES).optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  seed: z.coerce.number().int().optional(),
  filters: FiltersParamSchema.optional(),
  /** One label's, artist's or seller's records only, as "label:123", "artist:45" or "seller:6". */
  scope: ScopeParamSchema.optional(),
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
  /** Restores a verdict's original date (undo); omitted, the verdict is dated now. */
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  /** Restores when the record was last judged in Digga (undo); omitted, see dugAtAfter(). */
  dugAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type VerdictInput = z.input<typeof VerdictInputSchema>;
export type VerdictResponse = Verdict;

// DELETE /api/verdicts/:key
export interface DeleteVerdictResponse {
  deleted: boolean;
  previous: Verdict | null;
}

// POST /api/track-verdicts
export const TrackVerdictInputSchema = z
  .object({
    releaseId: z.number().int().positive(),
    position: z.string().min(1),
    mark: z.enum(TRACK_MARKS).nullable(),
    notes: z.string().max(4000).nullable().optional(),
    /** The video playing and the second it had reached; omitted, the saved ones stay. */
    videoId: z.string().min(1).optional(),
    atSeconds: z.number().nonnegative().optional(),
  })
  .refine((input) => (input.videoId === undefined) === (input.atSeconds === undefined), {
    message: "videoId and atSeconds come together",
  });
export type TrackVerdictInput = z.infer<typeof TrackVerdictInputSchema>;
export type TrackVerdictResponse = TrackVerdict | null;

// POST /api/listen-log
export const ListenLogInputSchema = z.object({
  releaseId: z.number().int().positive(),
  position: z.string().nullable().optional(),
  videoId: z.string().min(1),
  seconds: z.number().nonnegative(),
  /** False for a play shorter than the player's threshold: logged, the tune stays unheard. */
  heard: z.boolean().default(true),
});
export type ListenLogInput = z.input<typeof ListenLogInputSchema>;
export interface ListenLogResponse {
  id: number;
  /** The tune the listen made heard; null for a play logged as not heard. */
  heardKey: string | null;
}

/** The verdicts Twelves shows on its shelves. */
export const TWELVES_STATUSES: VerdictStatus[] = [
  "accepted",
  "wantlist",
  "collection",
  "maybe",
  "candidate",
  "snoozed",
  "no_audio",
];

// POST /api/releases/:id/videos attaches a YouTube video the user found; answers ReleaseDetail
export const AttachVideoInputSchema = z.object({ url: z.string().min(1).max(2000) });
export type AttachVideoInput = z.infer<typeof AttachVideoInputSchema>;

// GET /api/twelves?status=accepted,wantlist
export const TwelvesQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((text) =>
      text ? text.split(",").map((x) => x.trim()) : ["accepted", "wantlist", "collection"],
    )
    .pipe(z.array(z.enum(VERDICT_STATUSES)).min(1)),
  applyFilters: z
    .string()
    .optional()
    .transform((text) => text === "1" || text === "true"),
});
export type TwelvesQuery = z.infer<typeof TwelvesQuerySchema>;
export type TwelvesQueryInput = z.input<typeof TwelvesQuerySchema>;

export interface TwelvesItem {
  verdict: Verdict;
  release: QueueItem | null;
  /** A release of this record is on the Discogs wantlist, as imported or pushed from Digga. */
  onWantlist: boolean;
}

export interface TwelvesResponse {
  items: TwelvesItem[];
  statuses: VerdictStatus[];
}

// GET /api/track-marks
export interface MarkedTrack {
  mark: TrackVerdict;
  /**
   * From the tracklist, or saved with the mark when the release no longer lists the position;
   * null for a mark from before Digga saved the tune.
   */
  track: { artistDisplay: string; title: string; durationSeconds: number | null } | null;
  release: QueueItem | null;
  /** The verdict on the record the track is on, if it has one. */
  verdict: Verdict | null;
}
export interface TrackMarksResponse {
  /** Newest mark first. */
  items: MarkedTrack[];
}

// GET /api/stats?filters&scope
export const StatsQuerySchema = z.object({
  filters: FiltersParamSchema.optional(),
  scope: ScopeParamSchema.optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export interface Stats {
  /** Records judged in Digga (triage or manual), also those whose verdict a seed has replaced. */
  dug: number;
  universe: {
    releases: number;
    keys: number;
    filteredKeys: number;
  };
  verdicts: Record<VerdictStatus, number>;
  remaining: number;
  /** Records still to dig in the scope the request named; null without one. */
  scopeRemaining: number | null;
  rate: {
    verdictsPerHour: number | null;
    sessions: number;
    etaHours: number | null;
  };
  dump: {
    date: string | null;
    loadedAt: string | null;
    /** The newest dump load that finished, with its records still to dig under the filters. */
    lastLoad: (DumpLoadSummary & { toDig: number }) | null;
  };
  heardTracks: number;
}

/** What one dump load changed. */
export interface DumpLoadSummary {
  /** Also the id of the scope of the releases it added, "load:<id>". */
  id: number;
  file: string;
  dumpDate: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Releases the load brought into the universe. */
  added: number;
  /** Releases in other styles it kept for their label or artist. */
  coverage: number;
  /** Universe releases it did not find; null when a limit stopped it. */
  missing: number | null;
}

// GET /api/scopes?q
export const ScopeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

/** A label, artist or seller whose name matches a search, with its records in the universe. */
export interface ScopeMatch extends QueueScope {
  records: number;
}

export interface ScopeSearchResponse {
  /** Most records first. */
  items: ScopeMatch[];
}

// GET|PUT /api/settings
export type SettingsResponse = Config;

// POST /api/jobs/dump-load
export const DumpLoadJobInputSchema = z.object({
  file: z.string().min(1),
  limit: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  labelsFile: z.string().optional(),
  artistsFile: z.string().optional(),
});
export type DumpLoadJobInput = z.input<typeof DumpLoadJobInputSchema>;

// GET /api/dumps
export interface DumpFile {
  /** discogs_YYYYMMDD_releases.xml.gz */
  name: string;
  /** YYYY-MM-DD, from the name. */
  date: string;
  bytes: number;
}
export interface DumpsResponse {
  directory: string;
  /** Newest first. */
  files: DumpFile[];
}

// GET /api/setup: what the first run needs to know
export interface SetupResponse {
  /** No dump load has finished yet, so the app opens the setup. */
  needed: boolean;
  catalogue: SetupCatalogue;
  seeds: SeedTally;
  /** Browsers with a history on this computer. */
  browsers: HistoryBrowser[];
}

export interface HistoryBrowser {
  name: Browser;
  /** False when the history exists but Digga may not read it, such as without Full Disk Access. */
  readable: boolean;
}

export interface SetupCatalogue {
  /** The newest releases dump on data.discogs.com; null when the listing could not be read. */
  newest: {
    date: string;
    file: string;
    /** As the listing shows it, rounded; null when it shows none. */
    bytes: number | null;
    /** The dumps folder has it already. */
    downloaded: boolean;
  } | null;
  /** Why the listing could not be read. */
  error: string | null;
  dumpsDir: string;
  /** Free space on the disk that holds the dumps folder; null when it cannot be read. */
  freeBytes: number | null;
  /** What the download needs free: the dump and 1 GB to spare; null while its size is unknown. */
  neededBytes: number | null;
}

/** The styles of the releases the collection and wantlist imports brought in, most first. */
export interface SeedTally {
  releases: number;
  styles: {
    name: string;
    releases: number;
    /** [year, releases], by year; releases without a year are left out. */
    years: [number, number][];
  }[];
}

// POST /api/jobs/import/:kind
export const IMPORT_KINDS = ["collection", "wantlist", "history", "list", "seller"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const BROWSERS = ["brave", "chrome", "firefox"] as const;
export type Browser = (typeof BROWSERS)[number];
export const ImportJobInputSchema = z.object({
  browser: z.enum(BROWSERS).optional(),
  path: z.string().optional(),
  /** List import: the Discogs list to read; defaults to discogs.maybeListId. */
  listId: z.number().int().positive().optional(),
  /** Seller import: the Discogs username whose shop to read. */
  username: z.string().trim().min(1).max(100).optional(),
});
export type ImportJobInput = z.infer<typeof ImportJobInputSchema>;

export type JobResponse = Job;
export interface JobsResponse {
  jobs: Job[];
}

// POST /api/discogs/wantlist/:id adds a release; DELETE takes it off again
export interface WantlistPushResponse {
  releaseId: number;
  ok: boolean;
}

// GET /api/discogs/account
/** A token set in the environment overrides the saved one and cannot be changed in the app. */
export type TokenSource = "environment" | "saved" | null;
export interface DiscogsAccountResponse {
  username: string;
  hasToken: boolean;
  tokenSource: TokenSource;
  /** The account the token belongs to; null without a token or when Discogs could not be asked. */
  tokenUsername: string | null;
  error: string | null;
}

// GET /api/discogs/profile: the account behind the token, for the setup
export interface DiscogsProfileResponse {
  username: string;
  collection: number | null;
  wantlist: number | null;
  /** The account's currency when the API prices in it; null otherwise. */
  currency: string | null;
}

// PUT /api/discogs/token saves the token, or removes the saved one with null; answers the account
export const DiscogsTokenInputSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "Paste the token")
    .max(200)
    .regex(/^[\x21-\x7e]+$/, "A Discogs token has no spaces or special characters")
    .nullable(),
});
export type DiscogsTokenInput = z.infer<typeof DiscogsTokenInputSchema>;

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

// GET /api/backups
export interface BackupSummary {
  /** Local day of the copy, YYYY-MM-DD. */
  day: string;
  bytes: number;
}
export interface BackupsResponse {
  directory: string;
  /** The database a backup replaces when restored. */
  databaseFile: string;
  /** How many daily copies are kept. */
  kept: number;
  /** Newest first. */
  backups: BackupSummary[];
  /** The daily decisions backups in the same folder, newest first. */
  decisions: { kept: number; backups: BackupSummary[] };
}

// GET /api/export/:file
export const EXPORT_FILES = ["decisions.json", "verdicts.csv", "track-marks.csv"] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

/** A release as exports describe it, for reading without the database. */
export interface ExportedRelease {
  releaseId: number | null;
  artist: string | null;
  title: string | null;
  label: string | null;
  catno: string | null;
  year: number | null;
  country: string | null;
}

export interface VerdictExport extends ExportedRelease {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes: string | null;
  decidedAt: string;
  dugAt: string | null;
}

export interface TrackMarkExport extends ExportedRelease {
  releaseId: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decidedAt: string;
  trackArtist: string | null;
  trackTitle: string | null;
  heardKey: string | null;
  videoId: string | null;
  atSeconds: number | null;
}

export interface DecisionsExport {
  app: "digga";
  exportedAt: string;
  verdicts: VerdictExport[];
  trackMarks: TrackMarkExport[];
}
