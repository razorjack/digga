import { isVinyl } from "../../src/shared/formats.ts";
import { matchVideos } from "../../src/shared/match-videos.ts";
import {
  artistDisplay,
  durationToSeconds,
  heardKeyFor,
  yearFromReleased,
} from "../../src/shared/normalize.ts";
import { triageKeyFor } from "../../src/shared/triage-key.ts";
import { youtubeIdFromUrl } from "../../src/shared/youtube.ts";
import type { ReleaseWrite } from "../../src/server/db/releases.ts";
import type { DumpRelease } from "./types.ts";

/** Pure conversion of a parsed dump release into the row set the database layer writes. */
export function dumpReleaseToWrite(rel: DumpRelease): ReleaseWrite {
  const display = artistDisplay(rel.artists);
  const firstLabel = rel.labels[0];
  const tracks = rel.tracklist.map((t, seq) => {
    const trackArtist = t.artists.length > 0 ? artistDisplay(t.artists) : display;
    return {
      seq,
      position: t.position,
      title: t.title,
      artists: t.artists,
      artistDisplay: trackArtist,
      durationSeconds: durationToSeconds(t.duration),
      heardKey: heardKeyFor(trackArtist, t.title),
    };
  });
  const videoInputs = rel.videos
    .map((v) => ({ v, videoId: youtubeIdFromUrl(v.src) }))
    .filter((x): x is { v: (typeof rel.videos)[number]; videoId: string } => x.videoId !== null);
  const matches = matchVideos(
    tracks.map((t) => ({ position: t.position, title: t.title, artist: t.artistDisplay })),
    videoInputs.map((x) => ({ title: x.v.title })),
  );
  const seen = new Set<string>();
  const videos = videoInputs
    .filter((x) => {
      if (seen.has(x.videoId)) return false;
      seen.add(x.videoId);
      return true;
    })
    .map((x, i) => ({
      videoId: x.videoId,
      src: x.v.src,
      title: x.v.title,
      durationSeconds: x.v.duration,
      embeddable: x.v.embed,
      matchedPosition: matches[i]?.position ?? null,
    }));
  return {
    id: rel.id,
    masterId: rel.masterId && rel.masterId > 0 ? rel.masterId : null,
    isMainRelease: rel.isMainRelease,
    title: rel.title,
    artists: rel.artists,
    artistDisplay: display,
    labels: rel.labels,
    labelName: firstLabel ? firstLabel.name : null,
    catno: firstLabel && firstLabel.catno !== "" ? firstLabel.catno : null,
    year: yearFromReleased(rel.released),
    releasedRaw: rel.released,
    country: rel.country,
    formats: rel.formats,
    isVinyl: isVinyl(rel.formats),
    genres: rel.genres,
    styles: rel.styles,
    inUniverse: true,
    triageKey: triageKeyFor({ id: rel.id, masterId: rel.masterId }),
    tracks,
    videos,
  };
}
