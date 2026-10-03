import { wantlistKeys } from "../importers/seeds.ts";
import type { MarkedTrack } from "../../shared/api.ts";
import type { TrackMark } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { getVerdict } from "../db/verdicts.ts";
import { queueItemForRelease } from "./query.ts";

interface MarkedTrackRow {
  release_id: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decided_at: string;
  heard_key: string | null;
  video_id: string | null;
  at_seconds: number | null;
  track_artist: string | null;
  track_title: string | null;
  duration_seconds: number | null;
  tracklist_changed: number;
}

/**
 * Every marked track, newest mark first, with its release and the record's verdict. A position
 * the release no longer lists shows the tune saved with the mark.
 */
export function listMarkedTracks(db: Db): MarkedTrack[] {
  const onWantlist = wantlistKeys(db);
  const rows = db
    .prepare(
      `SELECT tv.release_id, tv.position, tv.mark, tv.notes, tv.decided_at,
         tv.heard_key, tv.video_id, tv.at_seconds,
         COALESCE(tv.artist_display, t.artist_display) AS track_artist,
         COALESCE(tv.title, t.title) AS track_title, t.duration_seconds, t.seq IS NULL AS tracklist_changed
       FROM track_verdicts tv
       LEFT JOIN tracks t ON t.release_id = tv.release_id AND t.seq = (
         SELECT MIN(s.seq) FROM tracks s WHERE s.release_id = tv.release_id AND s.position = tv.position
           AND (tv.heard_key IS NULL OR s.heard_key = tv.heard_key))
       ORDER BY tv.decided_at DESC, tv.release_id, tv.position`,
    )
    .all() as MarkedTrackRow[];
  return rows.map((row) => {
    const release = queueItemForRelease(db, row.release_id);
    return {
      onWantlist: release !== null && onWantlist.has(release.triageKey),
      tracklistChanged: Boolean(row.tracklist_changed),
      mark: {
        releaseId: row.release_id,
        position: row.position,
        mark: row.mark,
        notes: row.notes,
        decidedAt: row.decided_at,
        heardKey: row.heard_key,
        videoId: row.video_id,
        atSeconds: row.at_seconds,
      },
      track: markedTrackTitle(row),
      release,
      verdict: release ? getVerdict(db, release.triageKey) : null,
    };
  });
}

function markedTrackTitle(row: MarkedTrackRow): MarkedTrack["track"] {
  if (row.track_title === null) return null;
  return {
    artistDisplay: row.track_artist ?? "",
    title: row.track_title,
    durationSeconds: row.duration_seconds,
  };
}
