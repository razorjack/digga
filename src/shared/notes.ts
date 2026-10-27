/** A note as it is saved: trimmed, and null when nothing is left, which removes the note. */
export function normalizeNote(text: string): string | null {
  const note = text.trim();
  return note === "" ? null : note;
}
