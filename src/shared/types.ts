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
  "dump_load",
  "import_collection",
  "import_wantlist",
  "import_history",
  "import_list",
  "enrich",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

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

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DumpLoadProgress {
  phase: "scanning" | "done";
  scanned: number;
  matched: number;
  upserted: number;
  elapsedSeconds: number;
}

export interface ImportProgress {
  page: number;
  pages: number | null;
  processed: number;
  stubs: number;
  verdictsWritten: number;
}

export interface EnrichProgress {
  done: number;
  total: number;
  currentReleaseId: number | null;
  failed: number;
}
