export const VERDICT_STATUSES = [
  "collection",
  "wantlist",
  "seen",
  "rejected",
  "accepted",
  "maybe",
  "candidate",
  "no_audio",
  "snoozed",
] as const;
export type VerdictStatus = (typeof VERDICT_STATUSES)[number];

export const VERDICT_SOURCES = [
  "seed:collection",
  "seed:wantlist",
  "seed:history",
  "seed:list",
  "triage",
  "manual",
] as const;
export type VerdictSource = (typeof VERDICT_SOURCES)[number];

export const TRACK_MARKS = ["keep", "meh", "candidate"] as const;
export type TrackMark = (typeof TRACK_MARKS)[number];

export const JOB_TYPES = [
  "dump_download",
  "dump_load",
  "dump_update",
  "import_collection",
  "import_wantlist",
  "import_history",
  "import_list",
  "import_seller",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The error of a job the server found running when it started: Digga closed during it. */
export const INTERRUPTED_JOB_ERROR = "interrupted";

/**
 * The error of a load whose download did not match Discogs' checksum and is downloading once more:
 * the file it read was thrown away, so a load has to read the new download from the start.
 */
export const DOWNLOAD_RETRIED_ERROR =
  "The download did not match Discogs' checksum, so it is downloading once more";

export interface ArtistRef {
  id: number | null;
  name: string;
  /** Artist name variation used on this release, empty when none. */
  anv: string;
  /** Joining phrase to the next artist ("&", ",", "Feat."), empty for the last one. */
  join: string;
}

export interface LabelRef {
  id: number | null;
  name: string;
  catno: string;
}

export interface FormatRef {
  name: string;
  qty: number;
  text: string;
  descriptions: string[];
}

export interface ReleaseSnapshot {
  lowestPrice: number | null;
  numForSale: number | null;
  currency: string | null;
  communityHave: number | null;
  communityWant: number | null;
  enrichedAt: string | null;
}

export interface ReleaseRecord {
  id: number;
  masterId: number | null;
  isMainRelease: boolean;
  title: string;
  artists: ArtistRef[];
  artistDisplay: string;
  labels: LabelRef[];
  labelName: string | null;
  catno: string | null;
  year: number | null;
  releasedRaw: string | null;
  country: string | null;
  formats: FormatRef[];
  isVinyl: boolean;
  genres: string[];
  styles: string[];
  /** 0 for stub rows created from seeds for releases outside the loaded universe. */
  inUniverse: boolean;
  triageKey: string;
  snapshot: ReleaseSnapshot;
  updatedAt: string;
}

export interface TrackRecord {
  releaseId: number;
  seq: number;
  position: string;
  title: string;
  artists: ArtistRef[];
  artistDisplay: string;
  durationSeconds: number | null;
  heardKey: string;
}

export interface VideoRecord {
  releaseId: number;
  videoId: string;
  src: string;
  title: string;
  durationSeconds: number | null;
  embeddable: boolean;
  matchedPosition: string | null;
}

export interface Verdict {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes: string | null;
  releaseId: number | null;
  decidedAt: string;
}

export interface TrackVerdict {
  releaseId: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decidedAt: string;
}

export interface HeardTrack {
  heardKey: string;
  firstReleaseId: number;
  secondsListened: number;
  firstHeardAt: string;
  lastHeardAt: string;
}

interface JobRecord {
  id: string;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Finding the newest releases dump on data.discogs.com, then downloading it. */
export interface DumpDownloadProgress {
  phase: "finding" | "downloading" | "done";
  /** The dump's file name, once found. */
  file: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  /** The newest dump was in the dumps folder already, so nothing was downloaded. */
  alreadyDownloaded: boolean;
  /** Downloads that did not match Discogs' checksum; after the first, the dump comes once more. */
  checksumMismatches: number;
}

export interface DumpLoadProgress {
  phase: "scanning" | "done";
  scanned: number;
  /** Releases in the universe styles. */
  matched: number;
  /** Releases in other styles kept for their label or artist; known once the load is done. */
  coverage: number;
  upserted: number;
  elapsedSeconds: number;
  /** Releases new to the universe, and universe releases not found; known once the load is recorded. */
  added: number | null;
  missing: number | null;
  /** Bytes of the dump file read so far, compressed; null when it comes from stdin. */
  bytesRead: number | null;
  totalBytes: number | null;
  /** The last release kept in the styles; null before the first. */
  latest: KeptRelease | null;
  /** Releases kept in the styles per year, UNDATED_YEAR for those without one. */
  keptByYear: Record<string, number>;
}

/** The key of releases without a year in DumpLoadProgress.keptByYear. */
export const UNDATED_YEAR = "none";

/** A release a load kept, as the setup shows it while the load runs. */
export interface KeptRelease {
  id: number;
  artist: string;
  title: string;
  label: string | null;
  catno: string | null;
  year: number | null;
}

/** Downloading the newest dump unless the folder has it, then loading it. */
export type DumpUpdateProgress =
  | ({ step: "download" } & DumpDownloadProgress)
  | ({ step: "load" } & DumpLoadProgress);

export interface ImportProgress {
  page: number;
  pages: number | null;
  processed: number;
  stubs: number;
  verdictsWritten: number;
}

export interface HistoryImportProgress {
  files: number;
  urls: number;
  discogsUrls: number;
  keys: number;
  verdictsWritten: number;
}

/** Reading a seller's shop: pages of listings, then the records of it that are loaded. */
export interface SellerImportProgress {
  username: string;
  page: number;
  /** Pages to read: the shop's, at most 100. */
  pages: number | null;
  /** Listings the shop has for sale. */
  listings: number | null;
  /** Listings read so far. */
  read: number;
  /** Loaded records among them, one per triage key, once the read is saved. */
  records: number | null;
}

export interface JobProgressByType {
  dump_download: DumpDownloadProgress;
  dump_load: DumpLoadProgress;
  dump_update: DumpUpdateProgress;
  import_history: HistoryImportProgress;
  import_collection: ImportProgress;
  import_wantlist: ImportProgress;
  import_list: ImportProgress;
  import_seller: SellerImportProgress;
}

export type JobProgress = JobProgressByType[JobType];
export type Job = {
  [Kind in JobType]: JobRecord & { type: Kind; progress: JobProgressByType[Kind] | null };
}[JobType];
