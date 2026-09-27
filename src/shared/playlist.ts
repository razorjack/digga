import type { TrackDetail } from "./api.ts";
import type { VideoRecord } from "./types.ts";

export interface PlaylistEntry {
  video: VideoRecord;
  /** The track the video was matched to; null for label mixes, full sides and other strays. */
  track: TrackDetail | null;
  /** The tune was heard (on any release) before this release was opened. */
  heardBefore: boolean;
}

export interface PlaylistState {
  /** Video ids that failed to embed or play. */
  failed: ReadonlySet<string>;
  /** Video ids played while this release is open. */
  played: ReadonlySet<string>;
}

/** Embeddable videos in tracklist order; unmatched videos follow in their original order. */
export function buildPlaylist(detail: {
  tracks: TrackDetail[];
  videos: VideoRecord[];
}): PlaylistEntry[] {
  const byPosition = new Map<string, TrackDetail>();
  for (const t of detail.tracks)
    if (t.position !== "" && !byPosition.has(t.position)) byPosition.set(t.position, t);
  return detail.videos
    .filter((video) => video.embeddable)
    .map((video, order) => {
      const track =
        video.matchedPosition === null ? null : (byPosition.get(video.matchedPosition) ?? null);
      return { video, track, heardBefore: track?.heard ?? false, order };
    })
    .sort(
      (a, b) =>
        (a.track?.seq ?? Number.MAX_SAFE_INTEGER) - (b.track?.seq ?? Number.MAX_SAFE_INTEGER) ||
        a.order - b.order,
    )
    .map(({ video, track, heardBefore }) => ({ video, track, heardBefore }));
}

/**
 * The entry J and auto-advance move to: the next one that has not failed, whose tune was not
 * heard before and whose track was not already played from another upload. With `fallback`,
 * when only such entries remain, the next one that has not failed.
 */
export function nextEntry(
  entries: PlaylistEntry[],
  from: number | null,
  state: PlaylistState,
  opts: { fallback: boolean },
): number | null {
  const start = from === null ? 0 : from + 1;
  const playedPositions = new Set(
    entries
      .filter((e) => e.track !== null && state.played.has(e.video.videoId))
      .map((e) => e.track!.position),
  );
  for (let i = start; i < entries.length; i += 1) {
    const e = entries[i]!;
    if (state.failed.has(e.video.videoId) || e.heardBefore) continue;
    if (e.track && playedPositions.has(e.track.position) && !state.played.has(e.video.videoId))
      continue;
    return i;
  }
  if (!opts.fallback) return null;
  for (let i = start; i < entries.length; i += 1)
    if (!state.failed.has(entries[i]!.video.videoId)) return i;
  return null;
}

/** The entry a release starts on: the first unheard one, else the first playable one. */
export function firstEntry(entries: PlaylistEntry[], state: PlaylistState): number | null {
  return nextEntry(entries, null, state, { fallback: true });
}

/** The entry K moves to: the previous one that has not failed, heard or not. */
export function previousEntry(
  entries: PlaylistEntry[],
  from: number | null,
  state: PlaylistState,
): number | null {
  const start = from === null ? entries.length - 1 : from - 1;
  for (let i = start; i >= 0; i -= 1) if (!state.failed.has(entries[i]!.video.videoId)) return i;
  return null;
}

/** First entry playing the track at `position`, or null when no video matches it. */
export function entryForPosition(entries: PlaylistEntry[], position: string): number | null {
  const i = entries.findIndex((e) => e.track?.position === position);
  return i === -1 ? null : i;
}

/**
 * Where playback starts: `fraction` of the duration, at least a few seconds before the end.
 * Null when the duration is unknown; the player then seeks once it reports one.
 */
export function startSeconds(durationSeconds: number | null, fraction: number): number | null {
  if (durationSeconds === null || !(durationSeconds > 0)) return null;
  return Math.max(0, Math.min(Math.floor(durationSeconds * fraction), durationSeconds - 5));
}
