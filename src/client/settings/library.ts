import { formatCount } from "../../shared/display.ts";

/** What the last load did not find, which the library keeps; null when it found everything. */
export function missingReleasesNote(missing: number | null): string | null {
  if (!missing) return null;
  const releases = missing === 1 ? "release" : "releases";
  return `It did not find ${formatCount(missing)} ${releases} loaded before, which stay in the library.`;
}
