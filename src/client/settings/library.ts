import { formatCounted } from "../../shared/display.ts";

/** What the last load did not find, which the library keeps; null when it found everything. */
export function missingReleasesNote(missing: number | null): string | null {
  if (!missing) return null;
  const releases = formatCounted(missing, "release");
  if (missing === 1)
    return `${releases} from earlier loads was not in this one. It stays in your library.`;
  return `${releases} from earlier loads were not in this one. They stay in your library.`;
}
