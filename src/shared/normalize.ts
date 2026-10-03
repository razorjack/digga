import type { ArtistRef } from "./types.ts";

/** "Dom & Roland (2)" -> "Dom & Roland". Discogs appends (n) to disambiguate same-named artists. */
export function stripDisambiguation(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

/**
 * Lowercase, strip Latin diacritics, unify "&"/"and", drop punctuation, collapse whitespace.
 * Letters and digits of every script stay, so a title in Cyrillic or Japanese keeps its words.
 * Used for heard keys and fuzzy matching. Deliberately keeps remix/version text,
 * because a remix is a different tune.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized === "" ? [] : normalized.split(" ");
}

/** Discogs display form: "A & B Feat. C" using anv when present, no disambiguation suffixes. */
export function artistDisplay(artists: ArtistRef[]): string {
  return joinCredit(artists, (artist) =>
    stripDisambiguation(artist.anv !== "" ? artist.anv : artist.name),
  );
}

/** The artists joined as Discogs credits them, each under the name `nameOf` gives. */
function joinCredit(artists: ArtistRef[], nameOf: (artist: ArtistRef) => string): string {
  let display = "";
  artists.forEach((artist, index) => {
    display += nameOf(artist);
    if (index === artists.length - 1) return;
    const join = artist.join.trim();
    if (join === "") display += ", ";
    else if (join === ",") display += ", ";
    else display += ` ${join} `;
  });
  return display.trim();
}

/**
 * The rules heardKeyFor() follows. A library whose tracks were keyed by older rules is rekeyed
 * when it opens (`src/server/db/tune-keys.ts`).
 */
export const TUNE_KEY_VERSION = 2;

/** What identifies a tune on a tracklist. */
export interface TuneIdentity {
  /** The track's own artists, or the release's when the track credits none. */
  artists: ArtistRef[];
  title: string;
  /** The record the track is on: m:{master} or r:{release}. */
  recordKey: string;
  position: string;
}

/**
 * Identity of a tune across releases: the normalized Discogs artist names and title, as
 * "artist - title" (ASCII hyphen). The names are the canonical ones with Discogs' "(n)" suffix,
 * so two artists called Signal differ and one artist credited under another name does not. A
 * tune by nobody known, or with a title that names no tune ("Untitled", "Track 3"), is the
 * record's tune at its position, as "m:501 A1"; a normalized name never holds the colon.
 */
export function heardKeyFor(tune: TuneIdentity): string {
  const artist = normalizeText(artistNames(tune.artists));
  const title = normalizeText(tune.title);
  if (artist === "" || isAnonymous(tune.artists) || isGenericTitle(title))
    return `${tune.recordKey} ${tune.position}`;
  return `${artist} - ${title}`;
}

/** Discogs' artists for nobody known: Various, Unknown Artist and No Artist. */
const PLACEHOLDER_ARTIST_IDS = new Set([194, 355, 118760]);
const PLACEHOLDER_ARTIST_NAMES = new Set(["various", "unknown artist", "no artist"]);

/** Titles that name no tune of their own, once a trailing number or side letter is dropped. */
const GENERIC_TITLES = new Set([
  "untitled",
  "untitled track",
  "untitled mix",
  "unknown",
  "unknown title",
  "unknown track",
  "no title",
  "no titles",
  "track",
  "side",
  "this side",
  "that side",
  "other side",
  "flip side",
  "a side",
  "b side",
  "aa side",
  "intro",
  "outro",
  "interlude",
  "bonus track",
  "dub",
  "instrumental",
  "mix",
]);

function isAnonymous(artists: ArtistRef[]): boolean {
  return artists.every((artist) =>
    artist.id === null
      ? PLACEHOLDER_ARTIST_NAMES.has(normalizeText(stripDisambiguation(artist.name)))
      : PLACEHOLDER_ARTIST_IDS.has(artist.id),
  );
}

/** "Untitled 2", "Side B", "Track 01" and a bare position such as "B2" name no tune. */
function isGenericTitle(title: string): boolean {
  const stem = title.replace(/(?: (?:\d+|[a-z]|[a-z]\d+))+$/u, "");
  return GENERIC_TITLES.has(stem) || /^(?:[a-z]|aa|bb)?\d*$/u.test(title);
}

/** The credit under canonical names: "Ed Rush & Optical", "Signal (2) Feat. MC X". */
function artistNames(artists: ArtistRef[]): string {
  return joinCredit(artists, (artist) => artist.name.trim());
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
