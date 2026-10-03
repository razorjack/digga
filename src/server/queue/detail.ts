import { type ReleaseDetail, type TrackDetail } from "../../shared/api.ts";
import type { ReleaseRecord, TrackRecord, VideoRecord } from "../../shared/types.ts";
import { formatSummary } from "../../shared/formats.ts";
import { markForTrack } from "../../shared/track-identity.ts";
import type { Db } from "../db/db.ts";
import { poolVideos } from "../../shared/videos.ts";
import {
  countVideos,
  getPressingVideos,
  getRelease,
  getSiblings,
  getTracks,
  getUserVideos,
  getVideos,
} from "../db/releases.ts";
import { pressingNotes, releaseNote } from "../db/notes.ts";
import { getHeardKeys, getTrackVerdicts, getVerdict } from "../db/verdicts.ts";

export function buildReleaseDetail(db: Db, id: number): ReleaseDetail | null {
  const release = getRelease(db, id);
  if (!release) return null;
  const tracks = getTracks(db, id);
  const videos = releaseVideos(db, release, tracks);
  const heard = getHeardKeys(
    db,
    tracks.map((track) => track.heardKey),
  );
  const marks = getTrackVerdicts(db, id);
  const videoPositions = new Set(
    videos.map((video) => video.matchedPosition).filter((p): p is string => p !== null),
  );
  const trackDetails: TrackDetail[] = tracks.map((track) => ({
    ...track,
    heard: heard.has(track.heardKey),
    hasVideo: videoPositions.has(track.position),
    mark: markForTrack(track, marks, tracks)?.mark ?? null,
  }));
  return {
    release,
    tracks: trackDetails,
    videos,
    verdict: getVerdict(db, release.triageKey),
    note: releaseNote(db, id) ?? null,
    pressingNotes: pressingNotes(db, release),
    trackVerdicts: marks,
    siblings: getSiblings(db, release).map((sibling) => ({
      id: sibling.id,
      title: sibling.title,
      year: sibling.year,
      country: sibling.country,
      formatSummary: formatSummary(sibling.formats),
      labelName: sibling.labelName,
      catno: sibling.catno,
      isMainRelease: sibling.isMainRelease,
      videoCount: countVideos(db, sibling.id),
      inUniverse: sibling.inUniverse,
    })),
  };
}

/**
 * The videos the player gets for a release: its own from Discogs, the ones the user attached,
 * then those of other pressings of the master for tunes on this release.
 */
export function releaseVideos(
  db: Db,
  release: ReleaseRecord,
  tracks: TrackRecord[] = getTracks(db, release.id),
): VideoRecord[] {
  const own = withUserVideos(getVideos(db, release.id), getUserVideos(db, release.id));
  return poolVideos(tracks, own, getPressingVideos(db, release));
}

/** The release's videos from Discogs, then the ones the user attached that Discogs lacks. */
function withUserVideos(videos: VideoRecord[], attached: VideoRecord[]): VideoRecord[] {
  const known = new Set(videos.map((video) => video.videoId));
  return [...videos, ...attached.filter((video) => !known.has(video.videoId))];
}
