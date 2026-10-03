import type { ReleaseDetail } from "../../shared/api.ts";
import type { PlaylistEntry } from "../../shared/playlist.ts";
import type { PlaybackPosition } from "../../shared/replay.ts";
import { youtubeWatchUrl } from "../../shared/youtube.ts";

/**
 * A playlist entry for a saved moment. The track is the one with the saved tune, else the one the
 * upload is matched to; none when the tracklist has no single such track.
 */
export function bookmarkedEntry(detail: ReleaseDetail, playback: PlaybackPosition): PlaylistEntry {
  const video = detail.videos.find((candidate) => candidate.videoId === playback.videoId);
  const tune = playback.tune;
  const matches = detail.tracks.filter((track) => {
    if (tune) return track.heardKey === tune.heardKey;
    return track.position === video?.matchedPosition;
  });
  const track = matches.length === 1 ? matches[0]! : null;

  return {
    track,
    heardBefore: track?.heard ?? false,
    video: {
      releaseId: detail.release.id,
      videoId: playback.videoId,
      src: youtubeWatchUrl(playback.videoId),
      title: video?.title ?? tune?.title ?? "Saved upload",
      durationSeconds: video?.durationSeconds ?? null,
      embeddable: true,
      matchedPosition: track?.position ?? null,
    },
  };
}
