import type { TuneSnapshot } from "./api.ts";
import type { TrackRecord, TrackVerdict } from "./types.ts";

type TrackIdentity = Pick<TrackRecord, "position" | "heardKey">;

/**
 * The track a saved mark belongs to on the current tracklist: one with the mark's tune, the one
 * at the mark's position when the tune is on the release twice. Null when the tracklist no longer
 * has the tune.
 */
export function trackForMark<T extends TrackIdentity>(
  mark: Pick<TrackVerdict, "position" | "heardKey">,
  tracks: T[],
): T | null {
  const sameTune = tracks.filter((track) => track.heardKey === mark.heardKey);
  return sameTune.find((track) => track.position === mark.position) ?? sameTune[0] ?? null;
}

/** The saved mark of the track's tune. */
export function markForTrack(
  track: Pick<TrackRecord, "heardKey">,
  marks: TrackVerdict[],
): TrackVerdict | null {
  return marks.find((mark) => mark.heardKey === track.heardKey) ?? null;
}

/** The tune a mark or a listen saves, so a later catalogue edit cannot change what it refers to. */
export function tuneSnapshot(track: TuneSnapshot): TuneSnapshot {
  return { heardKey: track.heardKey, artistDisplay: track.artistDisplay, title: track.title };
}
