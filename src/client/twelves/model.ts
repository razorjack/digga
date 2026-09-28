import {
  TWELVES_STATUSES,
  type MarkedTrack,
  type QueueItem,
  type TwelvesItem,
} from "../../shared/api.ts";
import type { TrackMark, VerdictStatus } from "../../shared/types.ts";
import { isTriageSource } from "../../shared/verdict-rank.ts";
export type ShelfId =
  | "all"
  | "accepted"
  | "wantlist"
  | "collection"
  | "maybe"
  | "candidate"
  | "snoozed"
  | "tracks";

export type SortId = "newest" | "label" | "artist" | "year" | "price" | "want";

export const SHELVES: {
  id: ShelfId;
  label: string;
}[] = [
  { id: "all", label: "Everything" },
  { id: "accepted", label: "Want" },
  { id: "wantlist", label: "Discogs wantlist" },
  { id: "collection", label: "Owned" },
  { id: "maybe", label: "Maybe" },
  { id: "candidate", label: "Grail" },
  { id: "snoozed", label: "Snoozed" },
  { id: "tracks", label: "Tracks" },
];

/** The verdicts the record shelves load. */
export const STATUSES: VerdictStatus[] = TWELVES_STATUSES;

export const SORTS: {
  id: SortId;
  label: string;
}[] = [
  { id: "newest", label: "newest" },
  { id: "label", label: "label" },
  { id: "artist", label: "artist" },
  { id: "year", label: "year" },
  { id: "price", label: "price" },
  { id: "want", label: "most wanted" },
];

export const EMPTY: Record<ShelfId, string> = {
  all: "Nothing here yet. Press A on a release in Triage, or import your Discogs wantlist and collection.",
  accepted: "Nothing wanted yet. Press A on a release in Triage.",
  wantlist: "No wantlist imported. Run npm run digga -- import wantlist.",
  collection: "No collection imported. Run npm run digga -- import collection.",
  maybe: "No maybes. Press M in Triage for a release that belongs on your Discogs Maybe list.",
  candidate: "No grails yet. Press C in Triage for the one you've been hunting.",
  snoozed: "Nothing snoozed. Press L in Triage to hear a release again later.",
  tracks:
    "No marked tracks yet. In Triage, Shift+C marks the playing track as a grail and Shift+K as a keeper.",
};

/** The marks the Tracks shelf lists: the finds, not the tracks marked meh. */
export const SHELF_MARKS = new Set<TrackMark>(["candidate", "keep"]);

export const MARK_COPY: Record<TrackMark, string> = {
  keep: "keep",
  meh: "meh",
  candidate: "grail",
};

export const trackKey = (track: MarkedTrack) => `${track.mark.releaseId}\n${track.mark.position}`;

/** Only triage verdicts can be re-judged here; seeds describe the Discogs account. */
export const JUDGE_KEYS: Record<string, VerdictStatus> = {
  a: "accepted",
  m: "maybe",
  c: "candidate",
  r: "rejected",
  l: "snoozed",
};

export const TRIAGE_STATUSES = new Set<VerdictStatus>([
  "accepted",
  "maybe",
  "candidate",
  "rejected",
  "snoozed",
]);

/** A maybe decided in Digga that has not shown up on the Discogs list yet. */
export const notOnList = (i: TwelvesItem) =>
  i.verdict.status === "maybe" && isTriageSource(i.verdict.source);

/** A want that did not reach the Discogs wantlist (a failed push). */
export const notOnWantlist = (i: TwelvesItem) => i.verdict.status === "accepted" && !i.onWantlist;

export const releaseIdOf = (i: TwelvesItem) => i.verdict.releaseId ?? i.release?.id ?? null;

export const nameOf = (i: TwelvesItem) =>
  i.release ? `${i.release.artistDisplay} – ${i.release.title}` : i.verdict.key;

export function countShelves(items: TwelvesItem[], tracks: MarkedTrack[]): Record<ShelfId, number> {
  return {
    all: items.length,
    accepted: items.filter((item) => item.verdict.status === "accepted").length,
    wantlist: items.filter((item) => item.verdict.status === "wantlist").length,
    collection: items.filter((item) => item.verdict.status === "collection").length,
    maybe: items.filter((item) => item.verdict.status === "maybe").length,
    candidate: items.filter((item) => item.verdict.status === "candidate").length,
    snoozed: items.filter((item) => item.verdict.status === "snoozed").length,
    tracks: tracks.filter((track) => SHELF_MARKS.has(track.mark.mark)).length,
  };
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function compareNullable(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

/** What the sort orders compare: when the entry was decided and the release it is on. */
interface Sortable {
  decidedAt: string;
  release: QueueItem | null;
}

const comparators: Record<SortId, (left: Sortable, right: Sortable) => number> = {
  newest: (left, right) => right.decidedAt.localeCompare(left.decidedAt),
  label: (left, right) =>
    collator.compare(left.release?.labelName ?? "~", right.release?.labelName ?? "~") ||
    collator.compare(left.release?.catno ?? "", right.release?.catno ?? ""),
  artist: (left, right) =>
    collator.compare(left.release?.artistDisplay ?? "~", right.release?.artistDisplay ?? "~"),
  year: (left, right) =>
    compareNullable(left.release?.year ?? null, right.release?.year ?? null, 1),
  price: (left, right) =>
    compareNullable(left.release?.lowestPrice ?? null, right.release?.lowestPrice ?? null, 1),
  want: (left, right) =>
    compareNullable(left.release?.communityWant ?? null, right.release?.communityWant ?? null, -1),
};

export function visibleItems(
  items: TwelvesItem[],
  options: { shelf: ShelfId; sort: SortId; query: string },
): TwelvesItem[] {
  const query = options.query.trim().toLowerCase();
  const compare = comparators[options.sort];
  return items
    .filter((item) => matchesShelf(item, options.shelf) && matchesQuery(item, query))
    .toSorted((left, right) => compare(recordSortable(left), recordSortable(right)));
}

/** The Tracks shelf: grail and keep marks, filtered and sorted like the records. */
export function visibleTracks(
  tracks: MarkedTrack[],
  options: { sort: SortId; query: string },
): MarkedTrack[] {
  const query = options.query.trim().toLowerCase();
  const compare = comparators[options.sort];
  return tracks
    .filter((track) => SHELF_MARKS.has(track.mark.mark) && matchesTrackQuery(track, query))
    .toSorted((left, right) => compare(trackSortable(left), trackSortable(right)));
}

const recordSortable = (item: TwelvesItem): Sortable => ({
  decidedAt: item.verdict.decidedAt,
  release: item.release,
});

const trackSortable = (track: MarkedTrack): Sortable => ({
  decidedAt: track.mark.decidedAt,
  release: track.release,
});

function matchesShelf(item: TwelvesItem, shelf: ShelfId): boolean {
  return shelf === "all" || item.verdict.status === shelf;
}

function matchesQuery(item: TwelvesItem, query: string): boolean {
  if (query === "") return true;
  const release = item.release;
  return [
    release?.artistDisplay,
    release?.title,
    release?.labelName,
    release?.catno,
    item.verdict.notes,
  ].some((value) => value?.toLowerCase().includes(query));
}

function matchesTrackQuery(track: MarkedTrack, query: string): boolean {
  if (query === "") return true;
  const release = track.release;
  return [
    track.track?.artistDisplay,
    track.track?.title,
    track.mark.notes,
    release?.artistDisplay,
    release?.title,
    release?.labelName,
    release?.catno,
  ].some((value) => value?.toLowerCase().includes(query));
}
