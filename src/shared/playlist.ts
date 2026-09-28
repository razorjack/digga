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

/**
 * Embeddable videos in tracklist order; unmatched videos follow in their original order.
 * `heardElsewhere` adds heard keys the detail does not know about yet (heard after it was fetched).
 */
export function buildPlaylist(
  detail: { tracks: TrackDetail[]; videos: VideoRecord[] },
  heardElsewhere: ReadonlySet<string> = new Set(),
): PlaylistEntry[] {
  const byPosition = new Map<string, TrackDetail>();
  for (const track of detail.tracks)
    if (track.position !== "" && !byPosition.has(track.position))
      byPosition.set(track.position, track);
  return detail.videos
    .filter((video) => video.embeddable)
    .map((video, order) => {
      const track =
        video.matchedPosition === null ? null : (byPosition.get(video.matchedPosition) ?? null);
      const heardBefore = track !== null && (track.heard || heardElsewhere.has(track.heardKey));
      return { video, track, heardBefore, order };
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
  options: { fallback: boolean },
): number | null {
  const start = from === null ? 0 : from + 1;
  const playedPositions = new Set(
    entries
      .filter((entry) => entry.track !== null && state.played.has(entry.video.videoId))
      .map((entry) => entry.track!.position),
  );
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (state.failed.has(entry.video.videoId) || entry.heardBefore) continue;
    if (
      entry.track &&
      playedPositions.has(entry.track.position) &&
      !state.played.has(entry.video.videoId)
    )
      continue;
    return index;
  }
  if (!options.fallback) return null;
  for (let index = start; index < entries.length; index += 1)
    if (!state.failed.has(entries[index]!.video.videoId)) return index;
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
  for (let index = start; index >= 0; index -= 1)
    if (!state.failed.has(entries[index]!.video.videoId)) return index;
  return null;
}

/** First entry playing the track at `position`, or null when no video matches it. */
export function entryForPosition(entries: PlaylistEntry[], position: string): number | null {
  const index = entries.findIndex((entry) => entry.track?.position === position);
  return index === -1 ? null : index;
}

/**
 * Where playback starts: `fraction` of the duration, at least a few seconds before the end.
 * Null when the duration is unknown; the player then seeks once it reports one.
 */
export function startSeconds(durationSeconds: number | null, fraction: number): number | null {
  if (durationSeconds === null || !(durationSeconds > 0)) return null;
  return Math.max(0, Math.min(Math.floor(durationSeconds * fraction), durationSeconds - 5));
}
