import { type MatchTrack, matchVideos, VIDEO_MATCH_VERSION } from "../../shared/match-videos.ts";
import type { Db } from "./db.ts";

const RELEASES_PER_BATCH = 2000;

interface TrackRow extends MatchTrack {
  releaseId: number;
}

interface VideoRow {
  releaseId: number;
  videoId: string;
  title: string;
  matchedPosition: string | null;
}

/**
 * Brings a library whose videos were matched by older rules to VIDEO_MATCH_VERSION: each video's
 * track is matched again from the titles. Only `matched_position` changes; verdicts, marks and
 * listens stay as they are. Runs once, as the library opens; a dump load, an enrich and an
 * attached video match by the current rules themselves.
 */
export function rematchVideos(db: Db): void {
  const saved = db
    .prepare("SELECT value FROM meta WHERE key = 'video_match_version'")
    .pluck()
    .get();
  if (Number(saved ?? 1) >= VIDEO_MATCH_VERSION) return;
  db.transaction(() => {
    rematchReleaseVideos(db);
    rematchAttachedVideos(db);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('video_match_version', ?)").run(
      String(VIDEO_MATCH_VERSION),
    );
  })();
}

/** The videos Discogs lists, matched together per release in their stored order, as on load. */
function rematchReleaseVideos(db: Db): void {
  const batch = db
    .prepare(
      "SELECT DISTINCT release_id FROM videos WHERE release_id > ? ORDER BY release_id LIMIT ?",
    )
    .pluck();
  const readVideos = db.prepare(
    `SELECT release_id AS releaseId, video_id AS videoId, title, matched_position AS matchedPosition
     FROM videos WHERE release_id BETWEEN ? AND ? ORDER BY release_id, rowid`,
  );
  const write = db.prepare(
    "UPDATE videos SET matched_position = ? WHERE release_id = ? AND video_id = ?",
  );
  let releaseIds = batch.all(0, RELEASES_PER_BATCH) as number[];
  while (releaseIds.length > 0) {
    const first = releaseIds[0]!;
    const last = releaseIds.at(-1)!;
    const tracks = tracksByRelease(db, first, last);
    const videos = groupByRelease(readVideos.all(first, last) as VideoRow[]);
    for (const [releaseId, releaseVideos] of videos) {
      const matches = matchVideos(tracks.get(releaseId) ?? [], releaseVideos);
      releaseVideos.forEach((video, index) => {
        const position = matches[index]?.position ?? null;
        if (position !== video.matchedPosition) write.run(position, releaseId, video.videoId);
      });
    }
    releaseIds = batch.all(last, RELEASES_PER_BATCH) as number[];
  }
}

/** Videos the user attached, each matched alone as attaching one does. */
function rematchAttachedVideos(db: Db): void {
  const videos = db
    .prepare(
      `SELECT release_id AS releaseId, video_id AS videoId, title, matched_position AS matchedPosition
       FROM user_videos`,
    )
    .all() as VideoRow[];
  const write = db.prepare(
    "UPDATE user_videos SET matched_position = ? WHERE release_id = ? AND video_id = ?",
  );
  for (const video of videos) {
    const tracks = tracksByRelease(db, video.releaseId, video.releaseId).get(video.releaseId);
    // An attached video outlives its release; without tracks it keeps the match it has.
    if (!tracks) continue;
    const position = matchVideos(tracks, [video])[0]?.position ?? null;
    if (position !== video.matchedPosition) write.run(position, video.releaseId, video.videoId);
  }
}

function tracksByRelease(db: Db, first: number, last: number): Map<number, TrackRow[]> {
  const rows = db
    .prepare(
      `SELECT release_id AS releaseId, position, title, artist_display AS artist
       FROM tracks WHERE release_id BETWEEN ? AND ? ORDER BY release_id, seq`,
    )
    .all(first, last) as TrackRow[];
  return groupByRelease(rows);
}

function groupByRelease<Row extends { releaseId: number }>(rows: Row[]): Map<number, Row[]> {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.releaseId);
    if (group) group.push(row);
    else groups.set(row.releaseId, [row]);
  }
  return groups;
}
