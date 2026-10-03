import { isVinyl } from "../../src/shared/formats.ts";
import { prepareVideos } from "../../src/shared/videos.ts";
import {
  artistDisplay,
  durationToSeconds,
  heardKeyFor,
  yearFromReleased,
} from "../../src/shared/normalize.ts";
import { triageKeyFor } from "../../src/shared/triage-key.ts";
import type { ReleaseWrite, TrackWrite } from "../../src/server/db/releases.ts";
import type { DumpRelease } from "./types.ts";

/** Pure conversion of a parsed dump release into the row set the database layer writes. */
export function dumpReleaseToWrite(release: DumpRelease): ReleaseWrite {
  const display = artistDisplay(release.artists);
  const firstLabel = release.labels[0];
  const triageKey = triageKeyFor({ id: release.id, masterId: release.masterId });
  const tracks = prepareTracks(release, { display, recordKey: triageKey });
  const videos = prepareVideos(
    tracks.map((track) => ({
      position: track.position,
      title: track.title,
      artist: track.artistDisplay,
    })),
    release.videos.map((video) => ({
      src: video.src,
      title: video.title,
      durationSeconds: video.duration,
      embeddable: video.embed,
    })),
  );
  return {
    id: release.id,
    masterId: release.masterId && release.masterId > 0 ? release.masterId : null,
    isMainRelease: release.isMainRelease,
    title: release.title,
    artists: release.artists,
    artistDisplay: display,
    labels: release.labels,
    labelName: firstLabel ? firstLabel.name : null,
    catno: firstLabel && firstLabel.catno !== "" ? firstLabel.catno : null,
    year: yearFromReleased(release.released),
    releasedRaw: release.released,
    country: release.country,
    formats: release.formats,
    isVinyl: isVinyl(release.formats),
    genres: release.genres,
    styles: release.styles,
    inUniverse: true,
    triageKey,
    tracks,
    videos,
  };
}

/** A track without artists of its own is the release's artists'. */
function prepareTracks(
  release: DumpRelease,
  credit: { display: string; recordKey: string },
): TrackWrite[] {
  return release.tracklist.map((track, seq) => {
    const ownArtists = track.artists.length > 0;
    const tune = {
      artists: ownArtists ? track.artists : release.artists,
      title: track.title,
      recordKey: credit.recordKey,
      position: track.position,
    };
    return {
      seq,
      position: track.position,
      title: track.title,
      artists: track.artists,
      artistDisplay: ownArtists ? artistDisplay(track.artists) : credit.display,
      durationSeconds: durationToSeconds(track.duration),
      heardKey: heardKeyFor(tune),
    };
  });
}
