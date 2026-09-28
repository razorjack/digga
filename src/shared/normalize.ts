import type { ArtistRef } from "./types.ts";

/** "Dom & Roland (2)" -> "Dom & Roland". Discogs appends (n) to disambiguate same-named artists. */
export function stripDisambiguation(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

/**
 * Lowercase, strip diacritics, unify "&"/"and", drop punctuation, collapse whitespace.
 * Used for heard keys and fuzzy matching. Deliberately keeps remix/version text,
 * because a remix is a different tune.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized === "" ? [] : normalized.split(" ");
}

/** Discogs display form: "A & B Feat. C" using anv when present, no disambiguation suffixes. */
export function artistDisplay(artists: ArtistRef[]): string {
  let display = "";
  artists.forEach((artist, index) => {
    const name = stripDisambiguation(artist.anv !== "" ? artist.anv : artist.name);
    display += name;
    if (index === artists.length - 1) return;
    const join = artist.join.trim();
    if (join === "") display += ", ";
    else if (join === ",") display += ", ";
    else display += ` ${join} `;
  });
  return display.trim();
}

/** Identity of a tune across releases: normalized "artist - title" (ASCII hyphen). */
export function heardKeyFor(artist: string, title: string): string {
  return `${normalizeText(stripDisambiguation(artist))} - ${normalizeText(title)}`;
}

/** Discogs "released" is YYYY, YYYY-MM-DD, YYYY-00-00 or empty. Returns a plausible year or null. */
export function yearFromReleased(released: string | null | undefined): number | null {
  if (!released) return null;
  const match = /^(\d{4})/.exec(released.trim());
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  if (year < 1900 || year > 2100) return null;
  return year;
}

/** "1:23" | "01:02:03" | "83" -> seconds, or null when empty/unparseable. */
export function durationToSeconds(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const text = duration.trim();
  if (text === "") return null;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const parts = text.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
