import type { BackedUpData } from "../../shared/decisions-backup.ts";
import type { TrackMark, VerdictSource, VerdictStatus } from "../../shared/types.ts";
import { isTriageSource } from "../../shared/verdict-rank.ts";
import type { Db } from "./db.ts";
import { getVerdict, upsertVerdict } from "./verdicts.ts";

/** What a restore wrote, and what it left because the library had it already. */
export interface RestoreOutcome {
  verdicts: { restored: number; keptNewer: number };
  trackMarks: { restored: number; keptNewer: number };
  heardTunes: { added: number };
  attachedVideos: { added: number; withoutRelease: number };
}

/**
 * Everything the decisions backup holds, oldest first. Ties are broken by key, so data that did
 * not change reads back identically.
 */
export function readBackedUpData(db: Db): BackedUpData {
  return {
    verdicts: readVerdicts(db),
    trackMarks: readTrackMarks(db),
    heardTunes: readHeardTunes(db),
    attachedVideos: readAttachedVideos(db),
    noAudioVideos: readNoAudioVideos(db),
  };
}

/**
 * Writes a backup into the library in one transaction. The backup wins, except over a verdict or
 * track mark made in Digga after the backup was written. Heard tunes and attached videos are
 * added to what the library has; a video whose release the library lacks is left out, since
 * videos belong to loaded releases.
 */
export function restoreBackedUpData(
  db: Db,
  data: BackedUpData,
  backedUpAt: string,
): RestoreOutcome {
  const backupTime = Date.parse(backedUpAt);
  return db.transaction(() => ({
    verdicts: restoreVerdicts(db, data, backupTime),
    trackMarks: restoreTrackMarks(db, data.trackMarks, backupTime),
    heardTunes: { added: addHeardTunes(db, data.heardTunes) },
    attachedVideos: addAttachedVideos(db, data.attachedVideos),
  }))();
}

function readVerdicts(db: Db): BackedUpData["verdicts"] {
  const rows = db.prepare("SELECT * FROM verdicts ORDER BY decided_at, key").all() as {
    key: string;
    status: VerdictStatus;
    source: VerdictSource;
    notes: string | null;
    release_id: number | null;
    decided_at: string;
  }[];
  return rows.map((row) => ({
    key: row.key,
    status: row.status,
    source: row.source,
    notes: row.notes,
    releaseId: row.release_id,
    decidedAt: row.decided_at,
  }));
}

function readTrackMarks(db: Db): BackedUpData["trackMarks"] {
  const rows = db
    .prepare("SELECT * FROM track_verdicts ORDER BY decided_at, release_id, position")
    .all() as {
    release_id: number;
    position: string;
    mark: TrackMark;
    notes: string | null;
    decided_at: string;
  }[];
  return rows.map((row) => ({
    releaseId: row.release_id,
    position: row.position,
    mark: row.mark,
    notes: row.notes,
    decidedAt: row.decided_at,
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

/** A verdict made in Digga after the backup stays; so do the videos its no-audio record had. */
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
  const outcome = { restored: 0, keptNewer: 0 };
  for (const verdict of data.verdicts) {
    const current = getVerdict(db, verdict.key);
    if (current && isTriageSource(current.source) && Date.parse(current.decidedAt) > backupTime) {
      outcome.keptNewer += 1;
      continue;
    }
    upsertVerdict(db, verdict);
    const videoIds = recorded.get(verdict.key);
    if (verdict.status === "no_audio" && videoIds)
      saveVideos.run(verdict.key, JSON.stringify(videoIds));
    else forgetVideos.run(verdict.key);
    outcome.restored += 1;
  }
  return outcome;
}

function restoreTrackMarks(
  db: Db,
  marks: BackedUpData["trackMarks"],
  backupTime: number,
): RestoreOutcome["trackMarks"] {
  const current = db.prepare(
    "SELECT decided_at FROM track_verdicts WHERE release_id = ? AND position = ?",
  );
  const save = db.prepare(
    `INSERT INTO track_verdicts (release_id, position, mark, notes, decided_at)
     VALUES (@releaseId, @position, @mark, @notes, @decidedAt)
     ON CONFLICT(release_id, position) DO UPDATE SET mark = excluded.mark, notes = excluded.notes,
       decided_at = excluded.decided_at`,
  );
  const outcome = { restored: 0, keptNewer: 0 };
  for (const mark of marks) {
    const row = current.get(mark.releaseId, mark.position) as { decided_at: string } | undefined;
    if (row && Date.parse(row.decided_at) > backupTime) {
      outcome.keptNewer += 1;
      continue;
    }
    save.run(mark);
    outcome.restored += 1;
  }
  return outcome;
}

function addHeardTunes(db: Db, tunes: BackedUpData["heardTunes"]): number {
  const insert = db.prepare(
    `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at, last_heard_at)
     VALUES (@heardKey, @firstReleaseId, @secondsListened, @firstHeardAt, @lastHeardAt)
     ON CONFLICT(heard_key) DO NOTHING`,
  );
  let added = 0;
  for (const tune of tunes) added += insert.run(tune).changes;
  return added;
}

function addAttachedVideos(
  db: Db,
  videos: BackedUpData["attachedVideos"],
): RestoreOutcome["attachedVideos"] {
  const hasRelease = db.prepare("SELECT 1 FROM releases WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO user_videos (release_id, video_id, src, title, matched_position, added_at)
     VALUES (@releaseId, @videoId, @src, @title, @matchedPosition, @addedAt)
     ON CONFLICT(release_id, video_id) DO NOTHING`,
  );
  const outcome = { added: 0, withoutRelease: 0 };
  for (const video of videos) {
    if (hasRelease.get(video.releaseId) === undefined) {
      outcome.withoutRelease += 1;
      continue;
    }
    outcome.added += insert.run(video).changes;
  }
  return outcome;
}
