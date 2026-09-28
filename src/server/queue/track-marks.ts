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
  artist_display: string | null;
  title: string | null;
  duration_seconds: number | null;
}

/** Every marked track, newest mark first, with its release and the record's verdict. */
export function listMarkedTracks(db: Db): MarkedTrack[] {
  const rows = db
    .prepare(
      `SELECT tv.release_id, tv.position, tv.mark, tv.notes, tv.decided_at,
         t.artist_display, t.title, t.duration_seconds
       FROM track_verdicts tv
       LEFT JOIN tracks t ON t.release_id = tv.release_id AND t.seq = (
         SELECT MIN(s.seq) FROM tracks s WHERE s.release_id = tv.release_id AND s.position = tv.position)
       ORDER BY tv.decided_at DESC, tv.release_id, tv.position`,
    )
    .all() as MarkedTrackRow[];
  return rows.map((row) => {
    const release = queueItemForRelease(db, row.release_id);
    return {
      mark: {
        releaseId: row.release_id,
        position: row.position,
        mark: row.mark,
        notes: row.notes,
        decidedAt: row.decided_at,
      },
      track: markedTrackTitle(row),
      release,
      verdict: release ? getVerdict(db, release.triageKey) : null,
    };
  });
}

function markedTrackTitle(row: MarkedTrackRow): MarkedTrack["track"] {
  if (row.title === null) return null;
  return {
    artistDisplay: row.artist_display ?? "",
    title: row.title,
    durationSeconds: row.duration_seconds,
  };
}
