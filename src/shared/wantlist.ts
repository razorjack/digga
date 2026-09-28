import type { TrackMark } from "./types.ts";

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
