import { z } from "zod";
import { SessionRowSchema } from "./digging-session.ts";
import { HISTORY_SCHEMAS } from "./history-backup.ts";
import { toUtcTimestamp } from "./timestamp.ts";
import { TRACK_MARKS, VERDICT_SOURCES, VERDICT_STATUSES } from "./types.ts";

/**
 * The daily decisions backup: every verdict with its note, the track marks, the tunes heard, the
 * videos attached by pasting a link, and the videos no-audio records had. Release data is left
 * out: the Discogs ids in the keys find it again after a dump load, so a library rebuilt from a
 * dump gets everything back with `digga restore`.
 */
export const DECISIONS_BACKUP_VERSION = 2;

const id = z.number().int().positive();
/** Backups written before Digga stored UTC throughout hold seed dates with Discogs' offset. */
const timestamp = z.string().min(1).transform(toUtcTimestamp);

/**
 * `dugAt` is absent from backups written before Digga kept it; restoring such a verdict dates it
 * as a new write would (dugAtAfter()).
 */
const BackupVerdictSchema = z.object({
  key: z.string().min(1),
  status: z.enum(VERDICT_STATUSES),
  source: z.enum(VERDICT_SOURCES),
  notes: z.string().nullable(),
  releaseId: id.nullable(),
  decidedAt: timestamp,
  dugAt: timestamp.nullable().optional(),
});

/** Backups written before Digga saved a mark's tune and moment read those as null. */
const BackupTrackMarkSchema = z.object({
  releaseId: id,
  position: z.string().min(1),
  mark: z.enum(TRACK_MARKS),
  notes: z.string().nullable(),
  decidedAt: timestamp,
  heardKey: z.string().nullable().default(null),
  artistDisplay: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  videoId: z.string().nullable().default(null),
  atSeconds: z.number().nonnegative().nullable().default(null),
});

const BackupHeardTuneSchema = z.object({
  heardKey: z.string().min(1),
  firstReleaseId: id,
  secondsListened: z.number().nonnegative(),
  firstHeardAt: timestamp,
  lastHeardAt: timestamp,
});

const BackupAttachedVideoSchema = z.object({
  releaseId: id,
  videoId: z.string().min(1),
  src: z.string().min(1),
  title: z.string(),
  matchedPosition: z.string().nullable(),
  addedAt: timestamp,
});

const BackupNoAudioVideosSchema = z.object({
  key: z.string().min(1),
  videoIds: z.array(z.string()),
});

export const DecisionsBackupSchema = z.object({
  app: z.literal("digga"),
  kind: z.literal("decisions"),
  version: z.union([z.literal(1), z.literal(DECISIONS_BACKUP_VERSION)]),
  backedUpAt: timestamp,
  verdicts: z.array(BackupVerdictSchema),
  trackMarks: z.array(BackupTrackMarkSchema),
  heardTunes: z.array(BackupHeardTuneSchema),
  attachedVideos: z.array(BackupAttachedVideoSchema),
  noAudioVideos: z.array(BackupNoAudioVideosSchema),
  listenLog: z.array(HISTORY_SCHEMAS.listenLog).default([]),
  verdictLog: z.array(HISTORY_SCHEMAS.verdictLog).default([]),
  trackMarkLog: z.array(HISTORY_SCHEMAS.trackMarkLog).default([]),
  sessions: z.array(SessionRowSchema).default([]),
  releaseNotes: z.array(HISTORY_SCHEMAS.releaseNotes).default([]),
  /**
   * The settings as saved, validated only when `digga restore --config` asks for them, so a
   * backup whose settings an older or newer Digga wrote still restores its decisions.
   */
  config: z.unknown().default(null),
});

export type DecisionsBackup = z.infer<typeof DecisionsBackupSchema>;

/** What a backup holds besides its header. */
export type BackedUpData = Pick<
  DecisionsBackup,
  | "verdicts"
  | "trackMarks"
  | "heardTunes"
  | "attachedVideos"
  | "noAudioVideos"
  | "sessions"
  | "releaseNotes"
  | "listenLog"
  | "verdictLog"
  | "trackMarkLog"
>;

/** Each section's fields in file order, so a backup reads the same whatever built its objects. */
export const BACKUP_FIELDS: { [Section in keyof BackedUpData]: string[] } = {
  verdicts: Object.keys(BackupVerdictSchema.shape),
  trackMarks: Object.keys(BackupTrackMarkSchema.shape),
  heardTunes: Object.keys(BackupHeardTuneSchema.shape),
  attachedVideos: Object.keys(BackupAttachedVideoSchema.shape),
  noAudioVideos: Object.keys(BackupNoAudioVideosSchema.shape),
  sessions: Object.keys(SessionRowSchema.shape),
  releaseNotes: Object.keys(HISTORY_SCHEMAS.releaseNotes.shape),
  listenLog: Object.keys(HISTORY_SCHEMAS.listenLog.shape),
  verdictLog: Object.keys(HISTORY_SCHEMAS.verdictLog.shape),
  trackMarkLog: Object.keys(HISTORY_SCHEMAS.trackMarkLog.shape),
};
