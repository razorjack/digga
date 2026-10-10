import type { BackedUpData } from "../../shared/decisions-backup.ts";
import {
  type MembershipKind,
  type TrackMark,
  VERDICT_SOURCES,
  VERDICT_STATUSES,
  type VerdictSource,
  type VerdictStatus,
} from "../../shared/types.ts";
import { isTriageSource, preferredVerdict } from "../../shared/verdict-rank.ts";
import { withoutChangeLogs } from "./change-logs.ts";
import type { Db } from "./db.ts";
import { readSessions, restoreSessions } from "./digging-sessions.ts";
import { readHistory, restoreHistory } from "./history-backup.ts";
import { remapTuneKeys } from "./tune-keys.ts";
import { recordKeyOf } from "./verdict-keys.ts";
import { countHeardTracks, getVerdict, upsertVerdict, type VerdictWrite } from "./verdicts.ts";

/** What a restore wrote, and what it left because the library had it already. */
export interface RestoreOutcome {
  /** `moved`: restored verdicts whose release a dump loaded since has put on another record. */
  verdicts: { restored: number; keptNewer: number; moved: number };
  /** Items of the Discogs account, including the seed verdicts of backups before version 3. */
  memberships: { restored: number };
  trackMarks: { restored: number; keptNewer: number };
  heardTunes: { added: number };
  attachedVideos: { added: number };
  /** `leftOut`: saved sessions this version cannot resume. */
  sessions: { restored: number; leftOut: number };
}

/**
 * Everything the decisions backup holds, oldest first. Ties are broken by key, so data that did
 * not change reads back identically.
 */
export function readBackedUpData(db: Db): BackedUpData {
  // One read transaction, so a write from another connection cannot land between sections.
  return db.transaction(() => ({
    ...readHistory(db),
    sessions: readSessions(db),
    verdicts: readVerdicts(db),
    memberships: readMemberships(db),
    trackMarks: readTrackMarks(db),
    heardTunes: readHeardTunes(db),
    attachedVideos: readAttachedVideos(db),
    noAudioVideos: readNoAudioVideos(db),
  }))();
}

/**
 * Writes a backup into the library in one transaction. A verdict or track mark keeps whichever
 * side changed it last; deleting one counts as a change. Backed-up verdicts that meet on one
 * record take the precedence a dump load uses. Listens and marks take the tune keys of
 * the tracks the library has; heard tunes are rebuilt from the listens, and those of the backup
 * no listen accounts for are added. Attached videos are added to what the library has; a video
 * whose release the library has not loaded waits for it.
 */
export function restoreBackedUpData(
  db: Db,
  data: BackedUpData,
  backedUpAt: string,
): RestoreOutcome {
  const backupTime = Date.parse(backedUpAt);
  const heardBefore = countHeardTracks(db);
  return db.transaction(() =>
    withoutChangeLogs(db, () => {
      const outcome = {
        verdicts: restoreVerdicts(db, data, backupTime),
        memberships: { restored: restoreMemberships(db, data) },
        trackMarks: restoreTrackMarks(db, data.trackMarks),
        attachedVideos: { added: addAttachedVideos(db, data.attachedVideos) },
      };
      restoreHistory(db, data);
      // The backup's keys may follow older rules or an older catalogue.
      remapTuneKeys(db);
      addHeardTunes(db, data.heardTunes);
      const heardTunes = { added: countHeardTracks(db) - heardBefore };
      return { ...outcome, heardTunes, sessions: restoreSessions(db, data.sessions) };
    }),
  )();
}

function readVerdicts(db: Db): BackedUpData["verdicts"] {
  const rows = db.prepare("SELECT * FROM verdicts ORDER BY decided_at, key").all() as {
    key: string;
    status: VerdictStatus;
    source: VerdictSource;
    release_id: number | null;
    decided_at: string;
    updated_at: string;
  }[];
  return rows.map((row) => ({
    key: row.key,
    status: row.status,
    source: row.source,
    releaseId: row.release_id,
    decidedAt: row.decided_at,
    updatedAt: row.updated_at,
  }));
}

function readMemberships(db: Db): BackedUpData["memberships"] {
  const rows = db
    .prepare("SELECT * FROM memberships ORDER BY added_at, kind, release_id")
    .all() as {
    kind: MembershipKind;
    release_id: number;
    master_id: number | null;
    date_added: string | null;
    rating: number | null;
    notes: string | null;
    added_at: string;
    imported_at: string;
    removed_at: string | null;
  }[];
  return rows.map((row) => ({
    kind: row.kind,
    releaseId: row.release_id,
    masterId: row.master_id,
    dateAdded: row.date_added,
    rating: row.rating,
    notes: row.notes,
    addedAt: row.added_at,
    importedAt: row.imported_at,
    removedAt: row.removed_at,
  }));
}

function readTrackMarks(db: Db): BackedUpData["trackMarks"] {
  const rows = db
    .prepare("SELECT * FROM track_verdicts ORDER BY decided_at, release_id, heard_key")
    .all() as {
    release_id: number;
    position: string;
    mark: TrackMark;
    notes: string | null;
    decided_at: string;
    heard_key: string;
    artist_display: string | null;
    title: string | null;
    video_id: string | null;
    at_seconds: number | null;
    updated_at: string;
  }[];
  return rows.map((row) => ({
    releaseId: row.release_id,
    position: row.position,
    mark: row.mark,
    notes: row.notes,
    decidedAt: row.decided_at,
    heardKey: row.heard_key,
    artistDisplay: row.artist_display,
    title: row.title,
    videoId: row.video_id,
    atSeconds: row.at_seconds,
    updatedAt: row.updated_at,
  }));
}

function readHeardTunes(db: Db): BackedUpData["heardTunes"] {
  const rows = db
    .prepare("SELECT * FROM heard_tracks ORDER BY first_heard_at, heard_key")
    .all() as {
    heard_key: string;
    first_release_id: number;
    seconds_listened: number;
    first_heard_at: string;
    last_heard_at: string;
  }[];
  return rows.map((row) => ({
    heardKey: row.heard_key,
    firstReleaseId: row.first_release_id,
    secondsListened: row.seconds_listened,
    firstHeardAt: row.first_heard_at,
    lastHeardAt: row.last_heard_at,
  }));
}

function readAttachedVideos(db: Db): BackedUpData["attachedVideos"] {
  const rows = db
    .prepare("SELECT * FROM user_videos ORDER BY added_at, release_id, video_id")
    .all() as {
    release_id: number;
    video_id: string;
    src: string;
    title: string;
    matched_position: string | null;
    added_at: string;
  }[];
  return rows.map((row) => ({
    releaseId: row.release_id,
    videoId: row.video_id,
    src: row.src,
    title: row.title,
    matchedPosition: row.matched_position,
    addedAt: row.added_at,
  }));
}

function readNoAudioVideos(db: Db): BackedUpData["noAudioVideos"] {
  const rows = db.prepare("SELECT * FROM no_audio_videos ORDER BY key").all() as {
    key: string;
    video_ids_json: string;
  }[];
  return rows.map((row) => ({
    key: row.key,
    videoIds: JSON.parse(row.video_ids_json) as string[],
  }));
}

/**
 * A record judged in Digga after the backup keeps its verdict; so do the videos its no-audio
 * record had. Each verdict goes to the record its release is on now. A backup before version 3
 * also holds the account's items as seed verdicts, and each verdict's note: those become
 * memberships and release notes.
 */
function restoreVerdicts(
  db: Db,
  data: Pick<BackedUpData, "verdicts" | "noAudioVideos">,
  backupTime: number,
): RestoreOutcome["verdicts"] {
  const recorded = new Map(data.noAudioVideos.map((entry) => [entry.key, entry.videoIds]));
  const saveVideos = db.prepare(
    `INSERT INTO no_audio_videos (key, video_ids_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET video_ids_json = excluded.video_ids_json`,
  );
  const forgetVideos = db.prepare("DELETE FROM no_audio_videos WHERE key = ?");
  for (const backedUp of data.verdicts) restoreVerdictNote(db, backedUp, backupTime);

  const outcome = { restored: 0, keptNewer: 0, moved: 0 };
  for (const arrivals of Map.groupBy(arrivingVerdicts(db, data.verdicts), (a) => a.write.key)) {
    const { write, backedUp } = strongestArrival(arrivals[1]);
    if (keepsLibraryVerdict(db, write)) {
      outcome.keptNewer += 1;
      continue;
    }
    upsertVerdict(db, write);
    const videoIds = recorded.get(backedUp.key);
    if (write.status === "no_audio" && videoIds)
      saveVideos.run(write.key, JSON.stringify(videoIds));
    else forgetVideos.run(write.key);
    outcome.restored += 1;
    if (write.key !== backedUp.key) outcome.moved += 1;
  }
  return outcome;
}

/** A backed-up verdict and the write that restores it under the key its release has now. */
interface ArrivingVerdict {
  backedUp: BackedUpData["verdicts"][number];
  write: VerdictWrite & { decidedAt: string; updatedAt: string };
}

/** The backup's verdicts as the library stores them; the seed verdicts of old backups are not. */
function arrivingVerdicts(db: Db, verdicts: BackedUpData["verdicts"]): ArrivingVerdict[] {
  const arriving: ArrivingVerdict[] = [];
  for (const backedUp of verdicts) {
    const write = verdictWriteOf(backedUp);
    if (write === null) continue;
    const updatedAt = backedUp.updatedAt ?? backedUp.decidedAt;
    const key = recordKeyOf(db, backedUp);
    arriving.push({ backedUp, write: { ...write, key, decidedAt: backedUp.decidedAt, updatedAt } });
  }
  return arriving;
}

/** Of backed-up verdicts that meet on one record, the one a dump load would keep. */
function strongestArrival(arrivals: ArrivingVerdict[]): ArrivingVerdict {
  return arrivals.reduce((kept, next) =>
    preferredVerdict(kept.write, next.write) === kept.write ? kept : next,
  );
}

/**
 * Whether the record keeps the library's verdict: the side that changed it last wins, except that
 * a history hit never overrides a decision made in Digga, either way.
 */
function keepsLibraryVerdict(db: Db, write: ArrivingVerdict["write"]): boolean {
  const current = getVerdict(db, write.key);
  if (current !== null && isTriageSource(current.source) !== isTriageSource(write.source))
    return isTriageSource(current.source);
  return laterThan(verdictChangedAt(db, write.key), write.updatedAt);
}

/** When the library last wrote or deleted the record's verdict; null when it never had one. */
function verdictChangedAt(db: Db, key: string): string | null {
  const updatedAt = db.prepare("SELECT updated_at FROM verdicts WHERE key = ?").pluck().get(key);
  if (typeof updatedAt === "string") return updatedAt;
  return db
    .prepare("SELECT MAX(at) FROM verdict_log WHERE key = ? AND change = 'delete'")
    .pluck()
    .get(key) as string | null;
}

/** Whether the library's change came after the backup's. */
function laterThan(changedHere: string | null, changedInBackup: string): boolean {
  return changedHere !== null && Date.parse(changedHere) > Date.parse(changedInBackup);
}

/** A verdict as the library stores it; null for the seed verdict of a backup before version 3. */
function verdictWriteOf(backedUp: BackedUpData["verdicts"][number]): VerdictWrite | null {
  const status = VERDICT_STATUSES.find((known) => known === backedUp.status);
  const source = VERDICT_SOURCES.find((known) => known === backedUp.source);
  if (status === undefined || source === undefined) return null;
  return {
    key: backedUp.key,
    status,
    source,
    releaseId: backedUp.releaseId,
    decidedAt: backedUp.decidedAt,
  };
}

/** A backup before version 3 kept notes on verdicts; a note saved after the backup wins. */
function restoreVerdictNote(
  db: Db,
  verdict: { releaseId: number | null; notes?: string | null },
  backupTime: number,
): void {
  if (verdict.releaseId === null || verdict.notes === undefined || verdict.notes === null) return;
  db.prepare(
    `INSERT INTO release_notes (release_id, notes, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(release_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at
     WHERE excluded.updated_at > release_notes.updated_at`,
  ).run(verdict.releaseId, verdict.notes, new Date(backupTime).toISOString());
}

const LEGACY_SEED_KINDS: Partial<Record<string, MembershipKind>> = {
  "seed:collection": "collection",
  "seed:wantlist": "wantlist",
  "seed:list": "list",
};

/**
 * Adds the account's items the backup holds; one the library imported more recently keeps its
 * state. Returns how many were written.
 */
function restoreMemberships(db: Db, data: Pick<BackedUpData, "memberships" | "verdicts">): number {
  const save = db.prepare(
    `INSERT INTO memberships (kind, release_id, master_id, date_added, rating, notes, added_at,
       imported_at, removed_at)
     VALUES (@kind, @releaseId, @masterId, @dateAdded, @rating, @notes, @addedAt, @importedAt,
       @removedAt)
     ON CONFLICT(kind, release_id) DO UPDATE SET master_id = excluded.master_id,
       date_added = excluded.date_added, rating = excluded.rating, notes = excluded.notes,
       imported_at = excluded.imported_at, removed_at = excluded.removed_at
     WHERE excluded.imported_at > memberships.imported_at`,
  );
  let restored = 0;
  for (const membership of [...data.memberships, ...legacySeedMemberships(data.verdicts)])
    restored += save.run(membership).changes;
  return restored;
}

/** The seed verdicts of a backup before version 3, as the memberships they stood for. */
function legacySeedMemberships(verdicts: BackedUpData["verdicts"]): BackedUpData["memberships"] {
  const memberships: BackedUpData["memberships"] = [];
  for (const verdict of verdicts) {
    const kind = LEGACY_SEED_KINDS[verdict.source];
    if (kind === undefined || verdict.releaseId === null) continue;
    memberships.push({
      kind,
      releaseId: verdict.releaseId,
      masterId: null,
      dateAdded: verdict.decidedAt,
      rating: null,
      notes: null,
      addedAt: verdict.decidedAt,
      importedAt: verdict.decidedAt,
      removedAt: null,
    });
  }
  return memberships;
}

function restoreTrackMarks(
  db: Db,
  marks: BackedUpData["trackMarks"],
): RestoreOutcome["trackMarks"] {
  const save = db.prepare(
    `INSERT INTO track_verdicts (release_id, heard_key, position, mark, notes, decided_at,
       artist_display, title, video_id, at_seconds, updated_at)
     VALUES (@releaseId, @heardKey, @position, @mark, @notes, @decidedAt,
       @artistDisplay, @title, @videoId, @atSeconds, @updatedAt)
     ON CONFLICT(release_id, heard_key) DO UPDATE SET position = excluded.position,
       mark = excluded.mark, notes = excluded.notes, decided_at = excluded.decided_at,
       artist_display = excluded.artist_display, title = excluded.title,
       video_id = excluded.video_id, at_seconds = excluded.at_seconds,
       updated_at = excluded.updated_at`,
  );
  const outcome = { restored: 0, keptNewer: 0 };
  for (const backedUp of marks) {
    const mark = {
      ...backedUp,
      heardKey: backedUp.heardKey ?? positionTune(db, backedUp),
      updatedAt: backedUp.updatedAt ?? backedUp.decidedAt,
    };
    if (laterThan(markChangedAt(db, mark), mark.updatedAt)) {
      outcome.keptNewer += 1;
      continue;
    }
    save.run(mark);
    outcome.restored += 1;
  }
  return outcome;
}

/** When the library last wrote or deleted the mark on the tune; null when it never had one. */
function markChangedAt(db: Db, mark: { releaseId: number; heardKey: string }): string | null {
  const updatedAt = db
    .prepare("SELECT updated_at FROM track_verdicts WHERE release_id = ? AND heard_key = ?")
    .pluck()
    .get(mark.releaseId, mark.heardKey);
  if (typeof updatedAt === "string") return updatedAt;
  return db
    .prepare(
      `SELECT MAX(at) FROM track_mark_log
       WHERE release_id = ? AND heard_key = ? AND change = 'delete'`,
    )
    .pluck()
    .get(mark.releaseId, mark.heardKey) as string | null;
}

/**
 * The tune of a mark saved before marks kept theirs: the track at its position, else the release
 * and position, as migration 18 keyed such marks.
 */
function positionTune(db: Db, mark: { releaseId: number; position: string }): string {
  const heardKey = db
    .prepare("SELECT heard_key FROM tracks WHERE release_id = ? AND position = ? ORDER BY seq")
    .pluck()
    .get(mark.releaseId, mark.position) as string | undefined;
  return heardKey ?? `r:${mark.releaseId} ${mark.position}`;
}

/**
 * Backups before version 3 held heard tunes without the listens behind them, and every dump load
 * rebuilds heard_tracks from listen_log. A tune no heard listen accounts for gets one listen
 * standing in for its time, without a position or video, so it stays heard.
 */
function addHeardTunes(db: Db, tunes: BackedUpData["heardTunes"]): void {
  const insert = db.prepare(
    `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at, last_heard_at)
     VALUES (@heardKey, @firstReleaseId, @secondsListened, @firstHeardAt, @lastHeardAt)
     ON CONFLICT(heard_key) DO NOTHING`,
  );
  const listened = db
    .prepare("SELECT 1 FROM listen_log WHERE heard_key = ? AND heard IS NOT 0 LIMIT 1")
    .pluck();
  const standIn = db.prepare(
    `INSERT INTO listen_log (release_id, position, video_id, seconds, at, heard, heard_key)
     VALUES (@firstReleaseId, NULL, '', @secondsListened, @firstHeardAt, 1, @heardKey)`,
  );
  for (const tune of tunes) {
    if (!listened.get(tune.heardKey)) standIn.run(tune);
    insert.run(tune);
  }
}

function addAttachedVideos(db: Db, videos: BackedUpData["attachedVideos"]): number {
  const insert = db.prepare(
    `INSERT INTO user_videos (release_id, video_id, src, title, matched_position, added_at)
     VALUES (@releaseId, @videoId, @src, @title, @matchedPosition, @addedAt)
     ON CONFLICT(release_id, video_id) DO NOTHING`,
  );
  let added = 0;
  for (const video of videos) added += insert.run(video).changes;
  return added;
}
