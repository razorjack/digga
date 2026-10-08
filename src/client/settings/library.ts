import { formatCounted } from "../../shared/display.ts";

/** What the last load did not find, which the library keeps; null when it found everything. */
export function missingReleasesNote(missing: number | null): string | null {
  if (!missing) return null;
  return `It did not find ${formatCounted(missing, "release")} loaded before, which stay in the library.`;
}
