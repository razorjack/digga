import { type ReleaseDetail, type TrackDetail } from "../../shared/api.ts";
import { formatSummary } from "../../shared/formats.ts";
import type { Db } from "../db/db.ts";
import { poolVideos } from "../../shared/videos.ts";
import {
  countVideos,
  getPressingVideos,
  getRelease,
  getSiblings,
  getTracks,
  getVideos,
} from "../db/releases.ts";
import { getHeardKeys, getTrackVerdicts, getVerdict } from "../db/verdicts.ts";
export function buildReleaseDetail(db: Db, id: number): ReleaseDetail | null {
  const release = getRelease(db, id);
  if (!release) return null;
  const tracks = getTracks(db, id);
  // Other pressings of the master often carry videos for tunes this one has none for.
  const videos = poolVideos(tracks, getVideos(db, id), getPressingVideos(db, release));
  const heard = getHeardKeys(
    db,
    tracks.map((track) => track.heardKey),
  );
  const marks = new Map(getTrackVerdicts(db, id).map((mark) => [mark.position, mark]));
  const videoPositions = new Set(
    videos.map((video) => video.matchedPosition).filter((p): p is string => p !== null),
  );
  const trackDetails: TrackDetail[] = tracks.map((track) => ({
    ...track,
    heard: heard.has(track.heardKey),
    hasVideo: videoPositions.has(track.position),
    mark: marks.get(track.position)?.mark ?? null,
  }));
  return {
    release,
    tracks: trackDetails,
    videos,
    verdict: getVerdict(db, release.triageKey),
    trackVerdicts: [...marks.values()],
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
