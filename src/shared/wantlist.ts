import type { TrackMark, VerdictStatus } from "./types.ts";

/**
 * The verdicts that put a release on the Discogs wantlist: a want, and a grail, which is a want
 * the user has been hunting and stays marked as a grail in Digga.
 */
export function isWantlistVerdict(status: VerdictStatus): boolean {
  return status === "accepted" || status === "candidate";
}

/**
 * The waits before each new try of a push that failed on the way to Discogs or in Discogs; after
 * the last, the want stays in Digga and Twelves offers to add it.
 */
export const PUSH_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** Longest note Digga sends with a want. */
export const WANTLIST_NOTE_LENGTH = 255;

const MARK_LABELS: { mark: TrackMark; label: string }[] = [
  { mark: "candidate", label: "grail" },
  { mark: "keep", label: "keep" },
];

/**
 * The note that goes with a want on the Discogs wantlist: the tracks marked grail and keep, in
 * tracklist order, then the record's own note. "grail B1; keep A1, A2; heard on Kool FM".
 * Undefined when there is nothing to say.
 */
export function wantlistNote(
  marks: { position: string; mark: TrackMark }[],
  note: string | null,
): string | undefined {
  const parts: string[] = [];
  for (const { mark, label } of MARK_LABELS) {
    const positions = marks.filter((track) => track.mark === mark).map((track) => track.position);
    if (positions.length > 0) parts.push(`${label} ${positions.join(", ")}`);
  }
  if (note && note.trim() !== "") parts.push(note.trim());
  const text = parts.join("; ");
  if (text === "") return undefined;
  if (text.length <= WANTLIST_NOTE_LENGTH) return text;
  return `${text.slice(0, WANTLIST_NOTE_LENGTH - 3)}...`;
}
