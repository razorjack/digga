import { isVinyl } from "../../shared/formats.ts";
import { artistDisplay } from "../../shared/normalize.ts";
import { triageKeyFor } from "../../shared/triage-key.ts";
import { wantlistNote } from "../../shared/wantlist.ts";
import type { ArtistRef, FormatRef, LabelRef, ReleaseRecord } from "../../shared/types.ts";
import { type Db, nowIso } from "../db/db.ts";
import { getRelease, getTracks, insertStubRelease, type ReleaseWrite } from "../db/releases.ts";
import { applySeedVerdict, getTrackVerdicts, getVerdict } from "../db/verdicts.ts";
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

export function recordSeedItem(db: Db, item: SeedItemInput): void {
  db.prepare(
    `INSERT INTO seed_items (kind, release_id, master_id, date_added, rating, notes, basic_information_json, imported_at)
     VALUES (@kind, @release_id, @master_id, @date_added, @rating, @notes, @basic_information_json, @imported_at)
     ON CONFLICT(kind, release_id) DO UPDATE SET master_id = excluded.master_id, date_added = excluded.date_added,
       rating = excluded.rating, notes = excluded.notes, basic_information_json = excluded.basic_information_json,
       imported_at = excluded.imported_at`,
  ).run({
    kind: item.kind,
    release_id: item.releaseId,
    master_id: item.masterId,
    date_added: item.dateAdded,
    rating: item.rating,
    notes: item.notes,
    basic_information_json: JSON.stringify(item.basicInformation),
    imported_at: nowIso(),
  });
}

/**
 * Applies one seed item: stub row when the release is unknown, seed_items record,
 * and a verdict under the release's triage key (existing dump row wins for the key).
 */
export function applySeedItem(
  db: Db,
  item: SeedItemInput,
): { stubCreated: boolean; verdictWritten: boolean } {
  const existing = getRelease(db, item.releaseId);
  let stubCreated = false;
  let key: string;
  if (existing) {
    key = existing.triageKey;
  } else {
    const write = basicInformationToWrite(item.basicInformation);
    stubCreated = insertStubRelease(db, write);
    key = write.triageKey;
  }
  recordSeedItem(db, item);
  const status = item.kind === "collection" ? "collection" : "wantlist";
  const source = item.kind === "collection" ? "seed:collection" : "seed:wantlist";
  // The note written in Digga stays: a want's Discogs note is often the shorter one Digga sent.
  const notes = getVerdict(db, key)?.notes ?? item.notes;
  const { written } = applySeedVerdict(db, {
    key,
    status,
    source,
    notes,
    releaseId: item.releaseId,
    decidedAt: item.dateAdded ?? nowIso(),
  });
  return { stubCreated, verdictWritten: written };
}

/** API-shaped basic information from a stored release, for seed rows Digga writes itself. */
export function basicInformationFromRelease(release: ReleaseRecord): DiscogsBasicInformation {
  return {
    id: release.id,
    master_id: release.masterId,
    title: release.title,
    year: release.year ?? 0,
    artists: release.artists.map((artist) => ({
      id: artist.id ?? 0,
      name: artist.name,
      anv: artist.anv,
      join: artist.join,
    })),
    labels: release.labels.map((l) => ({ id: l.id ?? 0, name: l.name, catno: l.catno })),
    formats: release.formats.map((format) => ({
      name: format.name,
      qty: String(format.qty),
      text: format.text,
      descriptions: format.descriptions,
    })),
    genres: release.genres,
    styles: release.styles,
  };
}

/**
 * Records a release Digga put on the Discogs wantlist, as the next wantlist import would. The
 * verdict stays as it is; the row only tells Twelves that the release is on the wantlist.
 */
export function recordWantlistPush(db: Db, release: ReleaseRecord, notes: string | null): void {
  recordSeedItem(db, {
    kind: "wantlist",
    releaseId: release.id,
    masterId: release.masterId,
    dateAdded: nowIso(),
    rating: null,
    notes,
    basicInformation: basicInformationFromRelease(release),
  });
}

/** The note for a want: the release's grail and keep tracks, and the record's note. */
export function wantlistNoteFor(db: Db, release: ReleaseRecord): string | undefined {
  const order = new Map(getTracks(db, release.id).map((track) => [track.position, track.seq]));
  const marks = getTrackVerdicts(db, release.id).toSorted(
    (left, right) =>
      (order.get(left.position) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.position) ?? Number.MAX_SAFE_INTEGER),
  );
  return wantlistNote(marks, getVerdict(db, release.triageKey)?.notes ?? null);
}

export function forgetWantlistItem(db: Db, releaseId: number): void {
  db.prepare("DELETE FROM seed_items WHERE kind = 'wantlist' AND release_id = ?").run(releaseId);
}

/** Triage keys with at least one release on the Discogs wantlist. */
export function wantlistKeys(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.triage_key AS key FROM seed_items s
       JOIN releases r ON r.id = s.release_id WHERE s.kind = 'wantlist'`,
    )
    .all() as { key: string }[];
  return new Set(rows.map((release) => release.key));
}
