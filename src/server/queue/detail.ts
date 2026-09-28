import { type ReleaseDetail, type TrackDetail } from "../../shared/api.ts";
import { formatSummary } from "../../shared/formats.ts";
import type { Db } from "../db/db.ts";
import { countVideos, getRelease, getSiblings, getTracks, getVideos } from "../db/releases.ts";
import { getHeardKeys, getTrackVerdicts, getVerdict } from "../db/verdicts.ts";
export function buildReleaseDetail(db: Db, id: number): ReleaseDetail | null {
  const release = getRelease(db, id);
  if (!release) return null;
  const tracks = getTracks(db, id);
  const videos = getVideos(db, id);
  const heard = getHeardKeys(
    db,
    tracks.map((t) => t.heardKey),
  );
  const marks = new Map(getTrackVerdicts(db, id).map((tv) => [tv.position, tv]));
  const videoPositions = new Set(
    videos.map((v) => v.matchedPosition).filter((p): p is string => p !== null),
  );
  const trackDetails: TrackDetail[] = tracks.map((t) => ({
    ...t,
    heard: heard.has(t.heardKey),
    hasVideo: videoPositions.has(t.position),
    mark: marks.get(t.position)?.mark ?? null,
  }));
  return {
    release,
    tracks: trackDetails,
    videos,
    verdict: getVerdict(db, release.triageKey),
    trackVerdicts: [...marks.values()],
    siblings: getSiblings(db, release).map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      country: s.country,
      formatSummary: formatSummary(s.formats),
      labelName: s.labelName,
      catno: s.catno,
      isMainRelease: s.isMainRelease,
      videoCount: countVideos(db, s.id),
      inUniverse: s.inUniverse,
    })),
  };
}
