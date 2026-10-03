import { isVinyl } from "../../shared/formats.ts";
import { artistDisplay } from "../../shared/normalize.ts";
import { triageKeyFor } from "../../shared/triage-key.ts";
import { wantlistNote } from "../../shared/wantlist.ts";
import type { ArtistRef, FormatRef, LabelRef, ReleaseRecord } from "../../shared/types.ts";
import { type Db, nowIso } from "../db/db.ts";
import { forgetMembership, recordMembership } from "../db/memberships.ts";
import { releaseNote } from "../db/notes.ts";
import { getRelease, getTracks, insertStubRelease, type ReleaseWrite } from "../db/releases.ts";
import { getTrackVerdicts } from "../db/verdicts.ts";
import type {
  DiscogsArtist,
  DiscogsBasicInformation,
  DiscogsFormat,
  DiscogsLabel,
} from "../discogs/types.ts";

export function apiArtists(list: DiscogsArtist[] | undefined): ArtistRef[] {
  return (list ?? []).map((artist) => ({
    id: artist.id ?? null,
    name: artist.name,
    anv: artist.anv ?? "",
    join: (artist.join ?? "").trim(),
  }));
}

export function apiLabels(list: DiscogsLabel[] | undefined): LabelRef[] {
  return (list ?? []).map((l) => ({ id: l.id ?? null, name: l.name, catno: l.catno ?? "" }));
}

export function apiFormats(list: DiscogsFormat[] | undefined): FormatRef[] {
  return (list ?? []).map((format) => ({
    name: format.name,
    qty: Number.parseInt(format.qty ?? "1", 10) || 1,
    text: format.text ?? "",
    descriptions: format.descriptions ?? [],
  }));
}

/** Stub release row from a collection/wantlist item; no tracks or videos until the dump or enrich fills them. */
export function basicInformationToWrite(info: DiscogsBasicInformation): ReleaseWrite {
  const artists = apiArtists(info.artists);
  const labels = apiLabels(info.labels);
  const formats = apiFormats(info.formats);
  const masterId = info.master_id && info.master_id > 0 ? info.master_id : null;
  const first = labels[0];
  return {
    id: info.id,
    masterId,
    isMainRelease: false,
    title: info.title,
    artists,
    artistDisplay: artistDisplay(artists),
    labels,
    labelName: first ? first.name : null,
    catno: first && first.catno !== "" ? first.catno : null,
    year: info.year && info.year > 0 ? info.year : null,
    releasedRaw: info.year && info.year > 0 ? String(info.year) : null,
    country: null,
    formats,
    isVinyl: isVinyl(formats),
    genres: info.genres ?? [],
    styles: info.styles ?? [],
    inUniverse: false,
    triageKey: triageKeyFor({ id: info.id, masterId }),
    tracks: [],
    videos: [],
  };
}

export interface SeedItemInput {
  kind: "collection" | "wantlist";
  releaseId: number;
  masterId: number | null;
  dateAdded: string | null;
  rating: number | null;
  notes: string | null;
  basicInformation: DiscogsBasicInformation;
}

/**
 * Applies one collection or wantlist item: a stub row when the release is not loaded, and the
 * membership. Returns whether it made a stub and whether the item is new to Digga.
 */
export function applySeedItem(
  db: Db,
  item: SeedItemInput,
): { stubCreated: boolean; added: boolean } {
  const stubCreated =
    getRelease(db, item.releaseId) === null &&
    insertStubRelease(db, basicInformationToWrite(item.basicInformation));
  const added = recordMembership(db, {
    kind: item.kind,
    releaseId: item.releaseId,
    masterId: item.masterId,
    dateAdded: item.dateAdded,
    rating: item.rating,
    notes: item.notes,
  });
  return { stubCreated, added };
}

/**
 * Records a release Digga put on the Discogs wantlist, as the next wantlist import would, so
 * Twelves can tell which wants reached Discogs.
 */
export function recordWantlistPush(db: Db, release: ReleaseRecord, notes: string | null): void {
  recordMembership(db, {
    kind: "wantlist",
    releaseId: release.id,
    masterId: release.masterId,
    dateAdded: nowIso(),
    rating: null,
    notes,
  });
}

/** The note for a want: the release's grail and keep tracks, and its own note. */
export function wantlistNoteFor(db: Db, release: ReleaseRecord): string | undefined {
  const order = new Map(getTracks(db, release.id).map((track) => [track.position, track.seq]));
  const marks = getTrackVerdicts(db, release.id).toSorted(
    (left, right) =>
      (order.get(left.position) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.position) ?? Number.MAX_SAFE_INTEGER),
  );
  return wantlistNote(marks, releaseNote(db, release.id) ?? null);
}

/** Digga took the release off the Discogs wantlist. */
export function forgetWantlistItem(db: Db, releaseId: number): void {
  forgetMembership(db, "wantlist", releaseId);
}
