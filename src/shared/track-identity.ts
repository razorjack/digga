import type { TrackRecord, TrackVerdict } from "./types.ts";

type TrackIdentity = Pick<TrackRecord, "position" | "heardKey">;

export function trackForMark<T extends TrackIdentity>(mark: TrackVerdict, tracks: T[]): T | null {
  const position = tracks.find((track) => track.position === mark.position);
  if (!mark.heardKey) return position ?? null;
  if (position?.heardKey === mark.heardKey) return position;
  const matches = tracks.filter((track) => track.heardKey === mark.heardKey);
  return matches.length === 1 ? matches[0]! : null;
}

export function markForTrack(
  track: TrackIdentity,
  marks: TrackVerdict[],
  tracks: TrackIdentity[],
): TrackVerdict | null {
  return marks.find((mark) => trackForMark(mark, tracks)?.position === track.position) ?? null;
}

export class TrackIdentityConflict extends Error {}

export function assertTrackIdentity(mark: TrackVerdict | null, heardKey?: string): void {
  if (mark?.heardKey && heardKey && mark.heardKey !== heardKey) {
    throw new TrackIdentityConflict(
      "This position has a saved mark for a different tune. Review it in Twelves.",
    );
  }
}
