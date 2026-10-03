import type { BackedUpData } from "../../shared/decisions-backup.ts";
import {
  type MembershipKind,
  type TrackMark,
  VERDICT_SOURCES,
  VERDICT_STATUSES,
  type VerdictSource,
  type VerdictStatus,
} from "../../shared/types.ts";
import { isTriageSource } from "../../shared/verdict-rank.ts";
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
  return {
    ...readHistory(db),
    sessions: readSessions(db),
    verdicts: readVerdicts(db),
    memberships: readMemberships(db),
    trackMarks: readTrackMarks(db),
    heardTunes: readHeardTunes(db),
    attachedVideos: readAttachedVideos(db),
    noAudioVideos: readNoAudioVideos(db),
  };
}

/**
 * Writes a backup into the library in one transaction. The backup wins, except over a verdict or
 * track mark made in Digga after the backup was written. Listens and marks take the tune keys of
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
        trackMarks: restoreTrackMarks(db, data.trackMarks, backupTime),
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
  }[];
  return rows.map((row) => ({
    key: row.key,
    status: row.status,
    source: row.source,
    releaseId: row.release_id,
    decidedAt: row.decided_at,
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
  const outcome = { restored: 0, keptNewer: 0, moved: 0 };
  for (const backedUp of data.verdicts) {
    restoreVerdictNote(db, backedUp, backupTime);
    const verdict = verdictWriteOf(backedUp);
    if (verdict === null) continue;
    verdict.key = recordKeyOf(db, backedUp);
    if (decidedHereAfter(db, verdict.key, backupTime)) {
      outcome.keptNewer += 1;
      continue;
    }
    upsertVerdict(db, verdict);
    const videoIds = recorded.get(backedUp.key);
    if (verdict.status === "no_audio" && videoIds)
      saveVideos.run(verdict.key, JSON.stringify(videoIds));
    else forgetVideos.run(verdict.key);
    outcome.restored += 1;
    if (verdict.key !== backedUp.key) outcome.moved += 1;
  }
  return outcome;
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

function decidedHereAfter(db: Db, key: string, backupTime: number): boolean {
  const saved = getVerdict(db, key);
  return saved !== null && isTriageSource(saved.source) && Date.parse(saved.decidedAt) > backupTime;
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
  backupTime: number,
): RestoreOutcome["trackMarks"] {
  const current = db.prepare(
    "SELECT decided_at FROM track_verdicts WHERE release_id = ? AND heard_key = ?",
  );
  const save = db.prepare(
    `INSERT INTO track_verdicts (release_id, heard_key, position, mark, notes, decided_at,
       artist_display, title, video_id, at_seconds)
     VALUES (@releaseId, @heardKey, @position, @mark, @notes, @decidedAt,
       @artistDisplay, @title, @videoId, @atSeconds)
     ON CONFLICT(release_id, heard_key) DO UPDATE SET position = excluded.position,
       mark = excluded.mark, notes = excluded.notes, decided_at = excluded.decided_at,
       artist_display = excluded.artist_display, title = excluded.title,
       video_id = excluded.video_id, at_seconds = excluded.at_seconds`,
  );
  const outcome = { restored: 0, keptNewer: 0 };
  for (const backedUp of marks) {
    const mark = { ...backedUp, heardKey: backedUp.heardKey ?? positionTune(db, backedUp) };
    const row = current.get(mark.releaseId, mark.heardKey) as { decided_at: string } | undefined;
    if (row && Date.parse(row.decided_at) > backupTime) {
      outcome.keptNewer += 1;
      continue;
    }
    save.run(mark);
    outcome.restored += 1;
  }
  return outcome;
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

function addHeardTunes(db: Db, tunes: BackedUpData["heardTunes"]): void {
  const insert = db.prepare(
    `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at, last_heard_at)
     VALUES (@heardKey, @firstReleaseId, @secondsListened, @firstHeardAt, @lastHeardAt)
     ON CONFLICT(heard_key) DO NOTHING`,
  );
  for (const tune of tunes) insert.run(tune);
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
