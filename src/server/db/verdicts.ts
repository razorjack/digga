import type { ListenContext, TuneSnapshot } from "../../shared/api.ts";
import { assertTrackIdentity } from "../../shared/track-identity.ts";
import type {
  HeardTrack,
  TrackMark,
  TrackVerdict,
  Verdict,
  VerdictSource,
  VerdictStatus,
} from "../../shared/types.ts";
import { VERDICT_STATUSES } from "../../shared/types.ts";
import { toUtcTimestamp } from "../../shared/timestamp.ts";
import { dugAtAfter, seedRank } from "../../shared/verdict-rank.ts";
import { type Db, nowIso } from "./db.ts";
import { releaseNote } from "./notes.ts";

interface VerdictRow {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes: string | null;
  release_id: number | null;
  decided_at: string;
  dug_at: string | null;
}

interface TrackVerdictRow {
  release_id: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decided_at: string;
  heard_key: string | null;
  video_id: string | null;
  at_seconds: number | null;
}

interface HeardRow {
  heard_key: string;
  first_release_id: number;
  seconds_listened: number;
  first_heard_at: string;
  last_heard_at: string;
}

const rowToVerdict = (row: VerdictRow): Verdict => ({
  key: row.key,
  status: row.status,
  source: row.source,
  notes: row.notes,
  releaseId: row.release_id,
  decidedAt: row.decided_at,
  dugAt: row.dug_at,
});

const rowToTrackVerdict = (row: TrackVerdictRow): TrackVerdict => ({
  releaseId: row.release_id,
  position: row.position,
  mark: row.mark,
  notes: row.notes,
  decidedAt: row.decided_at,
  heardKey: row.heard_key,
  videoId: row.video_id,
  atSeconds: row.at_seconds,
});

export interface VerdictWrite {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes?: string | null;
  releaseId?: number | null;
  decidedAt?: string;
  /** Omitted, a decision made in Digga sets it and a seed keeps it (dugAtAfter()). */
  dugAt?: string | null;
}

export function getVerdict(db: Db, key: string): Verdict | null {
  const row = db.prepare("SELECT * FROM verdicts WHERE key = ?").get(key) as VerdictRow | undefined;
  return row ? rowToVerdict(row) : null;
}

export function getVerdicts(db: Db, keys: string[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const statement = db.prepare("SELECT * FROM verdicts WHERE key = ?");
  for (const key of keys) {
    const row = statement.get(key) as VerdictRow | undefined;
    if (row) out.set(key, rowToVerdict(row));
  }
  return out;
}

/**
 * Unconditional write (triage and manual decisions). Times are stored in UTC, whatever offset a
 * seed's Discogs date or an undo brings.
 */
export function upsertVerdict(db: Db, verdict: VerdictWrite): Verdict {
  const decidedAt = toUtcTimestamp(verdict.decidedAt ?? nowIso());
  const dugAt = dugAtAfter({ ...verdict, decidedAt }, getVerdict(db, verdict.key));
  db.prepare(
    `INSERT INTO verdicts (key, status, source, notes, release_id, decided_at, dug_at)
     VALUES (@key, @status, @source, @notes, @release_id, @decided_at, @dug_at)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, source = excluded.source, notes = excluded.notes,
       release_id = excluded.release_id, decided_at = excluded.decided_at, dug_at = excluded.dug_at`,
  ).run({
    key: verdict.key,
    status: verdict.status,
    source: verdict.source,
    notes: verdict.notes === undefined ? savedNoteOf(db, verdict.releaseId) : verdict.notes,
    release_id: verdict.releaseId ?? null,
    decided_at: decidedAt,
    dug_at: dugAt === null ? null : toUtcTimestamp(dugAt),
  });
  return getVerdict(db, verdict.key)!;
}

/** A verdict written without notes takes the note saved for its release. */
function savedNoteOf(db: Db, releaseId: number | null | undefined): string | null {
  if (releaseId === null || releaseId === undefined) return null;
  return releaseNote(db, releaseId) ?? null;
}

export function applySeedVerdict(
  db: Db,
  verdict: VerdictWrite,
): { written: boolean; previous: Verdict | null } {
  const previous = getVerdict(db, verdict.key);
  if (previous && seedRank(verdict) < seedRank(previous)) return { written: false, previous };
  if (
    previous &&
    previous.status === verdict.status &&
    previous.source === verdict.source &&
    previous.decidedAt === toUtcTimestamp(verdict.decidedAt ?? previous.decidedAt)
  ) {
    return { written: false, previous };
  }
  upsertVerdict(db, verdict);
  return { written: true, previous };
}

export function deleteVerdict(db: Db, key: string): Verdict | null {
  const previous = getVerdict(db, key);
  if (!previous) return null;
  db.prepare("DELETE FROM verdicts WHERE key = ?").run(key);
  return previous;
}

export function countVerdictsByStatus(db: Db): Record<VerdictStatus, number> {
  const counts = Object.fromEntries(VERDICT_STATUSES.map((s) => [s, 0])) as Record<
    VerdictStatus,
    number
  >;
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM verdicts GROUP BY status").all() as {
    status: VerdictStatus;
    n: number;
  }[];
  for (const row of rows) if (row.status in counts) counts[row.status] = row.n;
  return counts;
}

export function listVerdicts(db: Db, statuses: VerdictStatus[]): Verdict[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM verdicts WHERE status IN (${placeholders}) ORDER BY decided_at DESC`)
    .all(...statuses) as VerdictRow[];
  return rows.map(rowToVerdict);
}

/** Records judged in Digga, also those whose verdict a seed has replaced: the "dug" count. */
export function countDug(db: Db): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM verdicts WHERE dug_at IS NOT NULL").get() as {
      n: number;
    }
  ).n;
}

/** When each record was last judged in Digga, oldest first, for the rate/ETA estimate. */
export function triageDecisionTimes(db: Db, limit = 5000): string[] {
  const rows = db
    .prepare("SELECT dug_at FROM verdicts WHERE dug_at IS NOT NULL ORDER BY dug_at DESC LIMIT ?")
    .all(limit) as { dug_at: string }[];
  return rows.map((row) => row.dug_at).reverse();
}

export interface TrackMarkWrite {
  tune?: TuneSnapshot;
  releaseId: number;
  position: string;
  mark: TrackMark | null;
  notes?: string | null;
  /** The video playing when the mark was set; omitted with atSeconds, the saved moment stays. */
  videoId?: string;
  atSeconds?: number;
}

/**
 * Sets or clears the mark on a track. Omitted notes keep the saved ones, and the mark keeps its
 * date while it stays the same, so editing a note does not make an old mark new. The mark takes
 * its first tune snapshot and keeps it through later catalogue edits.
 */
export function setTrackVerdict(db: Db, input: TrackMarkWrite): TrackVerdict | null {
  const saved = getTrackVerdict(db, input.releaseId, input.position);
  assertTrackIdentity(saved, input.tune?.heardKey);

  if (input.mark === null) {
    db.prepare("DELETE FROM track_verdicts WHERE release_id = ? AND position = ?").run(
      input.releaseId,
      input.position,
    );
    return null;
  }
  writeTrackMark(db, input);
  return getTrackVerdict(db, input.releaseId, input.position);
}

function getTrackVerdict(db: Db, releaseId: number, position: string): TrackVerdict | null {
  const row = db
    .prepare("SELECT * FROM track_verdicts WHERE release_id = ? AND position = ?")
    .get(releaseId, position) as TrackVerdictRow | undefined;
  return row ? rowToTrackVerdict(row) : null;
}

function writeTrackMark(db: Db, input: TrackMarkWrite): void {
  const tune = input.tune ?? trackTune(db, input.releaseId, input.position);
  db.prepare(
    `INSERT INTO track_verdicts (release_id, position, mark, notes, decided_at,
       heard_key, artist_display, title, video_id, at_seconds)
     VALUES (@release_id, @position, @mark, @notes, @decided_at,
       @heard_key, @artist_display, @title, @video_id, @at_seconds)
     ON CONFLICT(release_id, position) DO UPDATE SET
       notes = CASE WHEN @keep_notes THEN track_verdicts.notes ELSE excluded.notes END,
       decided_at = CASE WHEN track_verdicts.mark = excluded.mark
         THEN track_verdicts.decided_at ELSE excluded.decided_at END,
       mark = excluded.mark,
       heard_key = COALESCE(track_verdicts.heard_key, excluded.heard_key),
       artist_display = COALESCE(track_verdicts.artist_display, excluded.artist_display),
       title = COALESCE(track_verdicts.title, excluded.title),
       video_id = CASE WHEN @keep_moment THEN track_verdicts.video_id ELSE excluded.video_id END,
       at_seconds = CASE WHEN @keep_moment THEN track_verdicts.at_seconds ELSE excluded.at_seconds END`,
  ).run({
    release_id: input.releaseId,
    position: input.position,
    mark: input.mark,
    notes: input.notes ?? null,
    keep_notes: input.notes === undefined ? 1 : 0,
    decided_at: nowIso(),
    heard_key: tune?.heardKey ?? null,
    artist_display: tune?.artistDisplay ?? null,
    title: tune?.title ?? null,
    video_id: input.videoId ?? null,
    at_seconds: input.atSeconds ?? null,
    keep_moment: input.videoId === undefined ? 1 : 0,
  });
}

function trackTune(db: Db, releaseId: number, position: string): TuneSnapshot | undefined {
  return db
    .prepare(
      `SELECT heard_key AS heardKey, artist_display AS artistDisplay, title FROM tracks
       WHERE release_id = ? AND position = ? ORDER BY seq LIMIT 1`,
    )
    .get(releaseId, position) as TuneSnapshot | undefined;
}

export function getTrackVerdicts(db: Db, releaseId: number): TrackVerdict[] {
  const rows = db
    .prepare("SELECT * FROM track_verdicts WHERE release_id = ? ORDER BY position")
    .all(releaseId) as TrackVerdictRow[];
  return rows.map(rowToTrackVerdict);
}

export function getHeardKeys(db: Db, heardKeys: string[]): Set<string> {
  const out = new Set<string>();
  const statement = db.prepare("SELECT heard_key FROM heard_tracks WHERE heard_key = ?");
  for (const key of heardKeys) if (statement.get(key)) out.add(key);
  return out;
}

export function countHeardTracks(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM heard_tracks").get() as { n: number }).n;
}

export interface ListenWrite {
  releaseId: number;
  position: string | null;
  videoId: string;
  seconds: number;
  /** False for a play too short to make the tune heard; it is logged all the same. */
  heard?: boolean;
  context?: ListenContext;
}

/**
 * Appends to listen_log and, when the play counts as heard and its position maps to a track,
 * accumulates heard_tracks.
 */
export function logListen(
  db: Db,
  input: ListenWrite,
): { id: number; heardKey: string | null; heard: HeardTrack | null } {
  const at = nowIso();
  const tune = listenedTune(db, input);
  const heardKey = input.heard === false ? null : (tune?.heardKey ?? null);
  const id = db.transaction(() => {
    const id = insertListen(db, input, { at, tune });
    if (heardKey !== null) {
      db.prepare(
        `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at, last_heard_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(heard_key) DO UPDATE SET seconds_listened = seconds_listened + excluded.seconds_listened,
           last_heard_at = excluded.last_heard_at`,
      ).run(heardKey, input.releaseId, input.seconds, at, at);
    }
    return id;
  })();
  return { id, heardKey, heard: heardKey === null ? null : getHeardTrack(db, heardKey) };
}

const NO_TUNE = { heardKey: null, artistDisplay: null, title: null };
const NO_CONTEXT = {
  playbackId: null,
  sessionId: null,
  startedAt: null,
  startSeconds: null,
  endSeconds: null,
  videoTitle: null,
};

/** One listen_log row; the playback context columns stay null for a listen posted without one. */
function insertListen(
  db: Db,
  input: ListenWrite,
  snapshot: { at: string; tune: TuneSnapshot | null },
): number {
  const { at } = snapshot;
  const tune = snapshot.tune ?? NO_TUNE;
  const context = input.context ?? NO_CONTEXT;
  const info = db
    .prepare(
      `INSERT INTO listen_log (release_id, position, video_id, seconds, at, heard,
         heard_key, artist_display, title,
         playback_id, session_id, started_at, start_seconds, end_seconds, video_title)
       VALUES (@release_id, @position, @video_id, @seconds, @at, @heard,
         @heard_key, @artist_display, @title,
         @playback_id, @session_id, @started_at, @start_seconds, @end_seconds, @video_title)`,
    )
    .run({
      release_id: input.releaseId,
      position: input.position,
      video_id: input.videoId,
      seconds: input.seconds,
      at,
      heard: input.heard === false ? 0 : 1,
      heard_key: tune.heardKey,
      artist_display: tune.artistDisplay,
      title: tune.title,
      playback_id: context.playbackId,
      session_id: context.sessionId,
      started_at: context.startedAt,
      start_seconds: context.startSeconds,
      end_seconds: context.endSeconds,
      video_title: context.videoTitle,
    });
  return Number(info.lastInsertRowid);
}

/** The tune the player saw, else the one the tracklist has at the position now. */
function listenedTune(db: Db, input: ListenWrite): TuneSnapshot | null {
  if (input.context) return input.context.tune;
  if (!input.position) return null;
  return trackTune(db, input.releaseId, input.position) ?? null;
}

function getHeardTrack(db: Db, heardKey: string): HeardTrack | null {
  const row = db.prepare("SELECT * FROM heard_tracks WHERE heard_key = ?").get(heardKey) as
    | HeardRow
    | undefined;
  if (!row) return null;
  return {
    heardKey: row.heard_key,
    firstReleaseId: row.first_release_id,
    secondsListened: row.seconds_listened,
    firstHeardAt: row.first_heard_at,
    lastHeardAt: row.last_heard_at,
  };
}
