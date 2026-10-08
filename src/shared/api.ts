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
  type MembershipKind,
  type RecordMembership,
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
  /** The Discogs id of the first label, the one labelName names; X hides the label by it. */
  labelId: number | null;
  labelName: string | null;
  catno: string | null;
  year: number | null;
  country: string | null;
  formatSummary: string;
  styles: string[];
  videoCount: number;
  communityWant: number | null;
  communityHave: number | null;
  /** The community rating out of 5; null when nobody has rated the release. */
  ratingAverage: number | null;
  ratingCount: number | null;
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
  /** The release's note; absent from details built before notes. */
  note?: string | null;
  /** Notes written on the record's other pressings, newest first. */
  pressingNotes: PressingNote[];
  trackVerdicts: TrackVerdict[];
  /** Other releases sharing the master, excluding this one. */
  siblings: ReleaseSibling[];
  /** The release's copies for sale in the shops Digga has read, cheapest first. */
  listings: ShopListing[];
}

/** A copy for sale in a seller's shop, as Digga read it. */
export interface ShopListing {
  /** The Discogs listing id. */
  id: number;
  seller: { id: number; username: string };
  /** Discogs's grade, such as "Near Mint (NM or M-)". */
  mediaCondition: string | null;
  /** The sleeve's grade, or "Generic", "Not Graded" or "No Cover". */
  sleeveCondition: string | null;
  /** In `currency`, the seller's. */
  price: number | null;
  currency: string | null;
  /** The seller's comment; empty when there is none. */
  comments: string;
  postedAt: string | null;
}

/** A note written on another pressing of the record, shown with its catalogue number. */
export interface PressingNote {
  releaseId: number;
  catno: string | null;
  notes: string;
}

export const ReleaseNoteInputSchema = z.object({ notes: z.string().max(4000).nullable() });

/**
 * The verdict a page saved or read on a record. An undo or a change in Twelves sends it, and the
 * server refuses the write with 409 when the record's verdict is no longer this one, as when
 * another tab decided it again.
 */
export const ExpectedVerdictSchema = z.object({
  status: z.enum(VERDICT_STATUSES),
  decidedAt: z.iso.datetime({ offset: true }),
});
export type ExpectedVerdict = z.infer<typeof ExpectedVerdictSchema>;

export function expectedVerdict(verdict: Verdict): ExpectedVerdict {
  return { status: verdict.status, decidedAt: verdict.decidedAt };
}

// POST /api/verdicts
export const VerdictInputSchema = z.object({
  key: z.string().regex(TRIAGE_KEY_PATTERN),
  status: z.enum(VERDICT_STATUSES),
  source: z.enum(VERDICT_SOURCES).default("triage"),
  releaseId: z.number().int().positive().nullable().optional(),
  /** Restores a verdict's original date (undo); omitted, the verdict is dated now. */
  decidedAt: z.iso.datetime({ offset: true }).optional(),
  /** Omitted, the verdict replaces whatever the record has. */
  expected: ExpectedVerdictSchema.optional(),
});
export type VerdictInput = z.input<typeof VerdictInputSchema>;
export type VerdictResponse = Verdict;

// DELETE /api/verdicts/:key?status=&decidedAt=, the expected verdict
export interface DeleteVerdictResponse {
  deleted: boolean;
  previous: Verdict | null;
}

export const TuneSnapshotSchema = z.object({
  heardKey: z.string().min(1).max(4000),
  artistDisplay: z.string().max(4000),
  title: z.string().max(4000),
});
export type TuneSnapshot = z.infer<typeof TuneSnapshotSchema>;

// POST /api/track-verdicts
export const TrackVerdictInputSchema = z
  .object({
    releaseId: z.number().int().positive(),
    /** Where the tune is on the tracklist; it locates the tune, the tune identifies the mark. */
    position: z.string().max(4000),
    tune: TuneSnapshotSchema,
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

export const ListenContextSchema = z.object({
  playbackId: z.uuid(),
  sessionId: z.uuid().nullable(),
  startedAt: z.iso.datetime(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  videoTitle: z.string().max(4000),
  tune: TuneSnapshotSchema.nullable(),
});
export type ListenContext = z.infer<typeof ListenContextSchema>;

// POST /api/listen-log
export const ListenLogInputSchema = z.object({
  releaseId: z.number().int().positive(),
  position: z.string().nullable().optional(),
  videoId: z.string().min(1),
  seconds: z.number().nonnegative(),
  /** False for a play shorter than the player's threshold: logged, the tune stays unheard. */
  heard: z.boolean().default(true),
  context: ListenContextSchema.optional(),
});
export type ListenLogInput = z.input<typeof ListenLogInputSchema>;
export interface ListenLogResponse {
  id: number;
  /** The tune the listen made heard; null for a play logged as not heard. */
  heardKey: string | null;
}

/** The verdicts Twelves shows on its shelves, besides what the Discogs account holds. */
export const TWELVES_STATUSES: VerdictStatus[] = [
  "accepted",
  "maybe",
  "candidate",
  "snoozed",
  "no_audio",
];

// POST /api/releases/:id/videos attaches a YouTube video the user found; answers ReleaseDetail
export const AttachVideoInputSchema = z.object({ url: z.string().min(1).max(2000) });
export type AttachVideoInput = z.infer<typeof AttachVideoInputSchema>;

// GET /api/twelves?status=snoozed
export const TwelvesQuerySchema = z.object({
  /** Only records with one of these verdicts; omitted, every record the shelves show. */
  status: z
    .string()
    .optional()
    .transform((text) => (text ? text.split(",").map((x) => x.trim()) : null))
    .pipe(z.array(z.enum(VERDICT_STATUSES)).min(1).nullable()),
  applyFilters: z
    .string()
    .optional()
    .transform((text) => text === "1" || text === "true"),
});
export type TwelvesQuery = z.infer<typeof TwelvesQuerySchema>;
export type TwelvesQueryInput = z.input<typeof TwelvesQuerySchema>;

/** A record on the Twelves shelves: decided in Digga, held by the Discogs account, or both. */
export interface TwelvesItem {
  /** The record's triage key. */
  key: string;
  /** The decision made in Digga; null for a record only the Discogs account holds. */
  verdict: Verdict | null;
  release: QueueItem | null;
  membership: RecordMembership;
  /** When it was decided, else when it reached the Discogs account; the newest sort reads it. */
  since: string;
  /** The shown release's note. */
  note: string | null;
  pressingNotes: PressingNote[];
}

export interface TwelvesResponse {
  items: TwelvesItem[];
}

// GET /api/track-marks
export interface MarkedTrack {
  mark: TrackVerdict;
  /**
   * The saved tune snapshot, falling back to a matching current track for legacy marks;
   * null for a mark from before Digga saved the tune.
   */
  track: { artistDisplay: string; title: string; durationSeconds: number | null } | null;
  release: QueueItem | null;
  /** The verdict on the record the track is on, if it has one. */
  verdict: Verdict | null;
  /** The record is on the Discogs wantlist, so replaying it in Triage keeps it there. */
  onWantlist?: boolean;
  /** The release no longer lists the marked tune at the mark's position. */
  tracklistChanged?: boolean;
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
  /** Records judged in Digga (triage or manual). */
  dug: number;
  universe: {
    releases: number;
    keys: number;
    filteredKeys: number;
  };
  verdicts: Record<VerdictStatus, number>;
  /** Releases the Discogs account holds, as imported or pushed. */
  discogs: Record<MembershipKind, number>;
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
  /** The server runs in Digga's desktop app, so the setup offers its file dialog. */
  desktop: boolean;
}

/** The releases dump the user chose with the desktop app's file dialog; null when cancelled. */
export interface DumpFileResponse {
  file: string | null;
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
  /** Whether a saved token is stored encrypted; the browser version saves it as text in secrets.env. */
  tokenEncrypted: boolean;
  /** The account the token belongs to; null without a token or when Discogs could not be asked. */
  tokenUsername: string | null;
  error: string | null;
  /**
   * The account whose collection, wantlist and Maybe list the library holds; null when it holds
   * none. Another account is refused until that data is forgotten.
   */
  dataAccount: string | null;
}

// DELETE /api/discogs/data: forget the account's collection, wantlist and Maybe list
export interface ForgetDiscogsDataResponse {
  /** How many items were forgotten. */
  forgotten: number;
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

// GET /api/backups
export interface BackupSummary {
  /** Local day of the copy, YYYY-MM-DD. */
  day: string;
  bytes: number;
}
export interface BackupsResponse {
  directory: string;
  /** How many daily copies are kept. */
  kept: number;
  /** Newest first. */
  backups: BackupSummary[];
  /** The daily decisions backups in the same folder, newest first. */
  decisions: { kept: number; backups: BackupSummary[] };
  checkpoints: { kept: number; backups: BackupSummary[] };
  /** The latest scheduled backup that failed, until a later one succeeds. */
  failure: BackupFailure | null;
}

export interface BackupFailure {
  at: string;
  /** What failed and why, one sentence per backup. */
  message: string;
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
  /** The note on the verdict's release. */
  notes: string | null;
  decidedAt: string;
}

export interface TrackMarkExport extends ExportedRelease {
  releaseId: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decidedAt: string;
  trackArtist: string | null;
  trackTitle: string | null;
  heardKey: string;
  videoId: string | null;
  atSeconds: number | null;
}

export interface DecisionsExport {
  app: "digga";
  exportedAt: string;
  verdicts: VerdictExport[];
  trackMarks: TrackMarkExport[];
}
