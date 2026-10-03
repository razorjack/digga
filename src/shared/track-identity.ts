import type { TuneSnapshot } from "./api.ts";
import type { TrackRecord, TrackVerdict } from "./types.ts";

type TrackIdentity = Pick<TrackRecord, "position" | "heardKey">;

/**
 * The track a saved mark belongs to on the current tracklist. A mark with a saved tune follows it
 * when a catalogue edit moves the tune to another position, as long as exactly one track has it.
 */
export function trackForMark<T extends TrackIdentity>(mark: TrackVerdict, tracks: T[]): T | null {
  const atPosition = tracks.find((track) => track.position === mark.position);
  if (!mark.heardKey) return atPosition ?? null;
  if (atPosition?.heardKey === mark.heardKey) return atPosition;

  const sameTune = tracks.filter((track) => track.heardKey === mark.heardKey);
  return sameTune.length === 1 ? sameTune[0]! : null;
}

/** The saved mark that belongs to the track; see trackForMark(). */
export function markForTrack(
  track: TrackIdentity,
  marks: TrackVerdict[],
  tracks: TrackIdentity[],
): TrackVerdict | null {
  return marks.find((mark) => trackForMark(mark, tracks)?.position === track.position) ?? null;
}

/** The tune a mark or a listen saves, so a later catalogue edit cannot change what it refers to. */
export function tuneSnapshot(track: TuneSnapshot): TuneSnapshot {
  return { heardKey: track.heardKey, artistDisplay: track.artistDisplay, title: track.title };
}

export class TrackIdentityConflict extends Error {}

/** Refuses to overwrite a position's mark that was saved for a different tune. */
export function assertTrackIdentity(mark: TrackVerdict | null, heardKey?: string): void {
  if (!mark?.heardKey || !heardKey || mark.heardKey === heardKey) return;
  throw new TrackIdentityConflict(
    "This position has a saved mark for a different tune. Review it in Twelves.",
  );
}
