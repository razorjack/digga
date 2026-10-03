import type { MarkedTrack, QueueItem, TuneSnapshot } from "./api.ts";
import type { Verdict } from "./types.ts";

export interface PlaybackPosition {
  releaseId: number;
  videoId: string;
  atSeconds: number;
  tune?: TuneSnapshot;
}

export interface ReplayItem {
  release: QueueItem | null;
  verdict: Verdict | null;
  onWantlist?: boolean;
}

export interface ReplayRequest {
  items: ReplayItem[];
  playback?: PlaybackPosition;
}

export function replayTrack(track: MarkedTrack): ReplayRequest {
  const request: ReplayRequest = { items: [track] };
  if (!track.mark.videoId) return request;
  request.playback = {
    releaseId: track.mark.releaseId,
    videoId: track.mark.videoId,
    atSeconds: track.mark.atSeconds ?? 0,
  };
  if (track.mark.heardKey && track.track) {
    request.playback.tune = { heardKey: track.mark.heardKey, ...track.track };
  }
  return request;
}
