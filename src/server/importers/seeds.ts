import { isVinyl } from "../../shared/formats.ts";
import { artistDisplay } from "../../shared/normalize.ts";
import { triageKeyFor } from "../../shared/triage-key.ts";
import type { ArtistRef, FormatRef, LabelRef } from "../../shared/types.ts";
import { type Db, nowIso } from "../db/db.ts";
import { getRelease, insertStubRelease, type ReleaseWrite } from "../db/releases.ts";
import { applySeedVerdict } from "../db/verdicts.ts";
import type {
  DiscogsArtist,
  DiscogsBasicInformation,
  DiscogsFormat,
  DiscogsLabel,
} from "../discogs/types.ts";

export function apiArtists(list: DiscogsArtist[] | undefined): ArtistRef[] {
  return (list ?? []).map((a) => ({
    id: a.id ?? null,
    name: a.name,
    anv: a.anv ?? "",
    join: (a.join ?? "").trim(),
  }));
}

export function apiLabels(list: DiscogsLabel[] | undefined): LabelRef[] {
  return (list ?? []).map((l) => ({ id: l.id ?? null, name: l.name, catno: l.catno ?? "" }));
}

export function apiFormats(list: DiscogsFormat[] | undefined): FormatRef[] {
  return (list ?? []).map((f) => ({
    name: f.name,
    qty: Number.parseInt(f.qty ?? "1", 10) || 1,
    text: f.text ?? "",
    descriptions: f.descriptions ?? [],
  }));
}

/** Stub release row from a collection/wantlist item; no tracks or videos until the dump or enrich fills them. */
export function basicInformationToWrite(bi: DiscogsBasicInformation): ReleaseWrite {
  const artists = apiArtists(bi.artists);
  const labels = apiLabels(bi.labels);
  const formats = apiFormats(bi.formats);
  const masterId = bi.master_id && bi.master_id > 0 ? bi.master_id : null;
  const first = labels[0];
  return {
    id: bi.id,
    masterId,
    isMainRelease: false,
    title: bi.title,
    artists,
    artistDisplay: artistDisplay(artists),
    labels,
    labelName: first ? first.name : null,
    catno: first && first.catno !== "" ? first.catno : null,
    year: bi.year && bi.year > 0 ? bi.year : null,
    releasedRaw: bi.year && bi.year > 0 ? String(bi.year) : null,
    country: null,
    formats,
    isVinyl: isVinyl(formats),
    genres: bi.genres ?? [],
    styles: bi.styles ?? [],
    inUniverse: false,
    triageKey: triageKeyFor({ id: bi.id, masterId }),
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
  const { written } = applySeedVerdict(db, {
    key,
    status,
    source,
    notes: item.notes,
    releaseId: item.releaseId,
    decidedAt: item.dateAdded ?? nowIso(),
  });
  return { stubCreated, verdictWritten: written };
}
