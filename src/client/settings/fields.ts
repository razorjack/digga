/** "Vinyl, CD" for a comma-separated field. */
export function joinList(items: readonly string[]): string {
  return items.join(", ");
}

/** The entries of a comma-separated field, trimmed, without empty ones. */
export function parseList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** The lines of a one-entry-per-line field, trimmed, without empty ones. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
