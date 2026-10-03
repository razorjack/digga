import type { ReleaseDetail } from "../../shared/api.ts";
import type { PlaylistEntry } from "../../shared/playlist.ts";
import type { PlaybackPosition } from "../../shared/replay.ts";
import { youtubeWatchUrl } from "../../shared/youtube.ts";

export function bookmarkedEntry(detail: ReleaseDetail, playback: PlaybackPosition): PlaylistEntry {
  const video = detail.videos.find((video) => video.videoId === playback.videoId);
  const matches = detail.tracks.filter((track) =>
    playback.tune
      ? track.heardKey === playback.tune.heardKey
      : track.position === video?.matchedPosition,
  );
  const track = matches.length === 1 ? matches[0]! : null;
  return {
    track,
    heardBefore: track?.heard ?? false,
    video: {
      releaseId: detail.release.id,
      videoId: playback.videoId,
      src: youtubeWatchUrl(playback.videoId),
      title: video?.title ?? playback.tune?.title ?? "Saved upload",
      durationSeconds: video?.durationSeconds ?? null,
      embeddable: true,
      matchedPosition: track?.position ?? null,
    },
  };
}
