import { matchVideos, type MatchTrack } from "./match-videos.ts";
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
