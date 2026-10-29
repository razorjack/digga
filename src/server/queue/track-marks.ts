import type { MarkedTrack } from "../../shared/api.ts";
import type { TrackMark } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { heldRecords } from "../db/memberships.ts";
import { getVerdicts } from "../db/verdicts.ts";
import { queueItems } from "./query.ts";

interface MarkedTrackRow {
  release_id: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decided_at: string;
  heard_key: string;
  video_id: string | null;
  at_seconds: number | null;
  track_artist: string | null;
  track_title: string | null;
  duration_seconds: number | null;
  tracklist_changed: number;
}

/**
 * Every marked track, newest mark first, with its release and the record's verdict. A tune the
 * release no longer lists shows as saved with the mark.
 */
export function listMarkedTracks(db: Db): MarkedTrack[] {
  const held = heldRecords(db);
  const rows = db
    .prepare(
      `SELECT tv.release_id, tv.position, tv.mark, tv.notes, tv.decided_at,
         tv.heard_key, tv.video_id, tv.at_seconds,
         COALESCE(tv.artist_display, t.artist_display) AS track_artist,
         COALESCE(tv.title, t.title) AS track_title, t.duration_seconds, t.seq IS NULL AS tracklist_changed
       FROM track_verdicts tv
       LEFT JOIN tracks t ON t.release_id = tv.release_id AND t.seq = (
         SELECT s.seq FROM tracks s WHERE s.release_id = tv.release_id AND s.heard_key = tv.heard_key
         ORDER BY s.position = tv.position DESC, s.seq LIMIT 1)
       ORDER BY tv.decided_at DESC, tv.release_id, tv.heard_key`,
    )
    .all() as MarkedTrackRow[];
  const ids = [...new Set(rows.map((row) => row.release_id))];
  const releases = new Map(queueItems(db, ids).map((release) => [release.id, release]));
  const verdicts = getVerdicts(
    db,
    [...releases.values()].map((release) => release.triageKey),
  );
  return rows.map((row) => {
    const release = releases.get(row.release_id) ?? null;
    return {
      wantlistReleaseIds:
        release === null ? [] : (held.get(release.triageKey)?.wantlistReleaseIds ?? []),
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
      verdict: release ? (verdicts.get(release.triageKey) ?? null) : null,
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
