import { matchVideos, type MatchTrack } from "./match-videos.ts";
import type { VideoRecord } from "./types.ts";
import { youtubeIdFromUrl } from "./youtube.ts";

export interface VideoInput {
  src: string;
  title: string;
  durationSeconds: number | null;
  embeddable: boolean;
}

export interface PreparedVideo extends VideoInput {
  videoId: string;
  matchedPosition: string | null;
}

export function prepareVideos(tracks: MatchTrack[], inputs: VideoInput[]): PreparedVideo[] {
  const videos = uniqueVideos(inputs);
  const matches = matchVideos(tracks, videos);
  return videos.map((video, index) => ({
    ...video,
    matchedPosition: matches[index]?.position ?? null,
  }));
}

function uniqueVideos(inputs: VideoInput[]): (VideoInput & { videoId: string })[] {
  const seen = new Set<string>();
  const videos: (VideoInput & { videoId: string })[] = [];
  for (const video of inputs) {
    const videoId = youtubeIdFromUrl(video.src);
    if (videoId === null || seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({ ...video, videoId });
  }
  return videos;
}

/** A video of another pressing, with the tune its matched track carries. */
export interface PressingVideo {
  video: VideoRecord;
  /** Heard key of the track the video was matched to on its own release; null when unmatched. */
  heardKey: string | null;
}

/**
 * The release's own videos, then videos of other pressings of the same master for tunes on this
 * release, matched to this release's position for the tune. Unmatched videos of other pressings
 * are left out: they may be bonus tracks or full sides that this release does not have.
 */
export function poolVideos(
  tracks: { position: string; heardKey: string }[],
  own: VideoRecord[],
  pressings: PressingVideo[],
): VideoRecord[] {
  const positions = new Map<string, string>();
  for (const track of tracks)
    if (track.position !== "" && !positions.has(track.heardKey))
      positions.set(track.heardKey, track.position);
  const videos = [...own];
  const seen = new Set(own.map((video) => video.videoId));
  for (const { video, heardKey } of pressings) {
    const position = heardKey === null ? undefined : positions.get(heardKey);
    if (position === undefined || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push({ ...video, matchedPosition: position });
  }
  return videos;
}

/** Whether the videos hold the one a YouTube link points at. */
export function hasVideoOfLink(videos: readonly { videoId: string }[], url: string): boolean {
  const videoId = youtubeIdFromUrl(url);
  return videoId !== null && videos.some((video) => video.videoId === videoId);
}
