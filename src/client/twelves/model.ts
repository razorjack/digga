import type { MarkedTrack, QueueItem, TwelvesItem } from "../../shared/api.ts";
import type { TrackMark, VerdictStatus } from "../../shared/types.ts";
import { isWantlistVerdict } from "../../shared/wantlist.ts";
import type { RecordStamp } from "../keymap.ts";
export type ShelfId =
  | "all"
  | "accepted"
  | "wantlist"
  | "collection"
  | "maybe"
  | "candidate"
  | "snoozed"
  | "tracks"
  | "no_audio";

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
  { id: "no_audio", label: "No audio" },
];

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
  wantlist: "No wantlist imported. Settings imports it, under Discogs.",
  collection: "No collection imported. Settings imports it, under Discogs.",
  maybe: "No maybes. Press M in Triage for a release that belongs on your Discogs Maybe list.",
  candidate: "No grails yet. Press C in Triage for the one you've been hunting.",
  snoozed: "Nothing snoozed. Press L in Triage to hear a release again later.",
  tracks:
    "No marked tracks yet. In Triage, Shift+C marks the playing track as a grail and Shift+K as a keeper.",
  no_audio: "Nothing here. D in Triage puts a record here when none of its videos plays.",
};

/** The marks the Tracks shelf lists: the finds, not the tracks marked meh. */
export const SHELF_MARKS = new Set<TrackMark>(["candidate", "keep"]);

export const MARK_COPY: Record<TrackMark, string> = {
  keep: "keep",
  meh: "meh",
  candidate: "grail",
};

/**
 * Rows a shelf shows at once. 4,000 rows took 1.5 s to open and half a second per sort; a page
 * this size renders in about a tenth of that, and J and K cross into the next page.
 */
export const PAGE_SIZE = 500;

/** One page of a sorted, filtered shelf. */
export interface Page<Item> {
  items: Item[];
  /** Zero-based. */
  index: number;
  count: number;
  /** One-based positions of the first and last item shown; 0 and 0 for an empty list. */
  first: number;
  last: number;
  total: number;
}

/** The page that holds the item at `selectedIndex`, or the first page when nothing is selected. */
export function pageAround<Item>(
  list: Item[],
  selectedIndex: number,
  size: number = PAGE_SIZE,
): Page<Item> {
  const index = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / size);
  const start = index * size;
  const items = list.slice(start, start + size);
  return {
    items,
    index,
    count: Math.max(1, Math.ceil(list.length / size)),
    first: items.length === 0 ? 0 : start + 1,
    last: start + items.length,
    total: list.length,
  };
}

/** Where the page before or after the one holding `selectedIndex` starts; null past either end. */
export function turnedPageStart(
  total: number,
  selectedIndex: number,
  turn: -1 | 1,
  size: number = PAGE_SIZE,
): number | null {
  const target = Math.floor(Math.max(0, selectedIndex) / size) + turn;
  if (target < 0 || target * size >= total) return null;
  return target * size;
}

export const trackKey = (track: MarkedTrack) => `${track.mark.releaseId}\n${track.mark.heardKey}`;

/** The verdicts a re-judgement in Twelves can write. */
export type JudgedStatus = "accepted" | "maybe" | "candidate" | "rejected" | "snoozed" | "no_audio";

/** Only records decided in Digga can be re-judged here; the rest is the Discogs account's. */
export const JUDGE_KEYS: Record<string, JudgedStatus> = {
  a: "accepted",
  m: "maybe",
  c: "candidate",
  r: "rejected",
  l: "snoozed",
  d: "no_audio",
};

export const TRIAGE_STATUSES = new Set<VerdictStatus>([
  "accepted",
  "maybe",
  "candidate",
  "rejected",
  "snoozed",
  "no_audio",
]);

/** A maybe decided in Digga that has not shown up on the Discogs list yet. */
export const notOnList = (i: TwelvesItem) => i.verdict?.status === "maybe" && !i.membership.onList;

/**
 * A want or grail that is not on the Discogs wantlist: a failed or undone push, or an old grail.
 * An owned record has ended its hunt, and so has one taken off the wantlist on Discogs.
 */
export const notOnWantlist = (i: TwelvesItem) =>
  isHunted(i) &&
  i.verdict !== null &&
  isWantlistVerdict(i.verdict.status) &&
  !i.membership.onWantlist;

/** Owning a record, or taking it off the wantlist on Discogs, ends the hunt for it. */
const isHunted = (i: TwelvesItem) => !i.membership.owned && !i.membership.wantRemoved;

/** The wants and grails on a shelf that are not on the Discogs wantlist. */
export function missingFromWantlist(items: TwelvesItem[], shelf: ShelfId): TwelvesItem[] {
  return items.filter((item) => notOnWantlist(item) && matchesShelf(item, shelf));
}

export const releaseIdOf = (i: TwelvesItem) => i.verdict?.releaseId ?? i.release?.id ?? null;

export const nameOf = (i: TwelvesItem) =>
  i.release ? `${i.release.artistDisplay} – ${i.release.title}` : i.key;

/**
 * What a record's stamp says: owned first, since owning ends the hunt, then a grail or want,
 * the Discogs wantlist, any other decision, and last the Maybe list.
 */
export function recordStamp(item: TwelvesItem): RecordStamp {
  const status = item.verdict?.status ?? null;
  if (item.membership.owned) return "collection";
  if (status === "candidate" || status === "accepted") return status;
  if (item.membership.onWantlist) return "wantlist";
  return status ?? "maybe";
}

/** The shelf a re-judgement puts the record on; a skip takes it off the shelves. */
const JUDGED_SHELF: Record<JudgedStatus, ShelfId | null> = {
  accepted: "accepted",
  maybe: "maybe",
  candidate: "candidate",
  snoozed: "snoozed",
  no_audio: "no_audio",
  rejected: null,
};

/** The flash's sentence for a re-judged record: where it went, by the shelf's own name. */
export function rejudgedSentence(name: string, status: JudgedStatus): string {
  const shelf = JUDGED_SHELF[status];
  if (shelf === null) return `${name} skipped, off the shelves.`;
  return `${name} moved to ${shelfLabel(shelf)}.`;
}

function shelfLabel(id: ShelfId): string {
  const shelf = SHELVES.find((candidate) => candidate.id === id);
  if (!shelf) throw new Error(`there is no ${id} shelf`);
  return shelf.label;
}

export function countShelves(items: TwelvesItem[], tracks: MarkedTrack[]): Record<ShelfId, number> {
  const count = (shelf: RecordShelf) => items.filter((item) => matchesShelf(item, shelf)).length;
  return {
    all: count("all"),
    accepted: count("accepted"),
    wantlist: count("wantlist"),
    collection: count("collection"),
    maybe: count("maybe"),
    candidate: count("candidate"),
    snoozed: count("snoozed"),
    tracks: tracks.filter((track) => SHELF_MARKS.has(track.mark.mark)).length,
    no_audio: count("no_audio"),
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
  decidedAt: item.since,
  release: item.release,
});

const trackSortable = (track: MarkedTrack): Sortable => ({
  decidedAt: track.mark.decidedAt,
  release: track.release,
});

type RecordShelf = Exclude<ShelfId, "tracks">;

/**
 * Whether a record is on a shelf. Want and Grail hold decisions made in Digga, Discogs wantlist
 * and Owned what the account holds, so one record can be on several; owning ends the hunt.
 */
const SHELF_TESTS: Record<Exclude<RecordShelf, "all">, (item: TwelvesItem) => boolean> = {
  accepted: (item) => item.verdict?.status === "accepted" && isHunted(item),
  candidate: (item) => item.verdict?.status === "candidate" && isHunted(item),
  wantlist: (item) => item.membership.onWantlist,
  collection: (item) => item.membership.owned,
  maybe: (item) => item.verdict?.status === "maybe" || item.membership.onList,
  snoozed: (item) => item.verdict?.status === "snoozed",
  no_audio: (item) => item.verdict?.status === "no_audio",
};

/** Everything is what you want, own or put aside, each record once; no audio has a shelf only. */
function matchesShelf(item: TwelvesItem, shelf: ShelfId): boolean {
  if (shelf === "tracks") return false;
  if (shelf !== "all") return SHELF_TESTS[shelf](item);
  return Object.entries(SHELF_TESTS).some(([other, test]) => other !== "no_audio" && test(item));
}

function matchesQuery(item: TwelvesItem, query: string): boolean {
  if (query === "") return true;
  const release = item.release;
  return [
    release?.artistDisplay,
    release?.title,
    release?.labelName,
    release?.catno,
    item.note,
    ...item.pressingNotes.map((pressing) => pressing.notes),
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
