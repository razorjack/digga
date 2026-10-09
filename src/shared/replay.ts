import type { MarkedTrack, QueueItem, TuneSnapshot, TwelvesItem } from "./api.ts";
import type { Verdict } from "./types.ts";

/** A moment in an upload to start playing from, and the tune it belongs to when known. */
export interface PlaybackPosition {
  releaseId: number;
  videoId: string;
  atSeconds: number;
  tune?: TuneSnapshot;
}

/** A record Twelves hands to Triage, with its saved decision. */
export interface ReplayItem {
  release: QueueItem | null;
  verdict: Verdict | null;
  wantlistReleaseIds?: number[];
}

export interface ReplayRequest {
  items: ReplayItem[];
  playback?: PlaybackPosition;
}

/** A Twelves record as Triage hears it again. */
export function replayItemOf(item: TwelvesItem): ReplayItem {
  return {
    release: item.release,
    verdict: item.verdict,
    wantlistReleaseIds: item.membership.wantlistReleaseIds,
  };
}

/** Replays a marked track's record, from the moment saved with the mark when it has one. */
export function replayTrack(track: MarkedTrack): ReplayRequest {
  const { mark } = track;
  if (!mark.videoId) return { items: [track] };

  const playback: PlaybackPosition = {
    releaseId: mark.releaseId,
    videoId: mark.videoId,
    atSeconds: mark.atSeconds ?? 0,
  };
  if (mark.heardKey && track.track) {
    const { artistDisplay, title } = track.track;
    playback.tune = { heardKey: mark.heardKey, artistDisplay, title };
  }
  return { items: [track], playback };
}
