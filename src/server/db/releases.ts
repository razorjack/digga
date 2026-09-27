import type {
  ArtistRef,
  FormatRef,
  LabelRef,
  ReleaseRecord,
  TrackRecord,
  VideoRecord,
} from "../../shared/types.ts";
import { type Db, nowIso } from "./db.ts";

export interface TrackWrite {
  seq: number;
  position: string;
  title: string;
  artists: ArtistRef[];
  artistDisplay: string;
  durationSeconds: number | null;
  heardKey: string;
}

export interface VideoWrite {
  videoId: string;
  src: string;
  title: string;
  durationSeconds: number | null;
  embeddable: boolean;
  matchedPosition: string | null;
}

export interface ReleaseWrite {
  id: number;
  masterId: number | null;
  isMainRelease: boolean;
  title: string;
  artists: ArtistRef[];
  artistDisplay: string;
  labels: LabelRef[];
  labelName: string | null;
  catno: string | null;
  year: number | null;
  releasedRaw: string | null;
  country: string | null;
  formats: FormatRef[];
  isVinyl: boolean;
  genres: string[];
  styles: string[];
  inUniverse: boolean;
  triageKey: string;
  tracks: TrackWrite[];
  videos: VideoWrite[];
}

export interface ReleaseRow {
  id: number;
  master_id: number | null;
  is_main_release: number;
  title: string;
  artists_json: string;
  artist_display: string;
  labels_json: string;
  label_name: string | null;
  catno: string | null;
  year: number | null;
  released_raw: string | null;
  country: string | null;
  formats_json: string;
  is_vinyl: number;
  genres_json: string;
  styles_json: string;
  in_universe: number;
  triage_key: string;
  lowest_price: number | null;
  num_for_sale: number | null;
  currency: string | null;
  community_have: number | null;
  community_want: number | null;
  enriched_at: string | null;
  updated_at: string;
}

export interface TrackRow {
  release_id: number;
  seq: number;
  position: string;
  title: string;
  artists_json: string;
  artist_display: string;
  duration_seconds: number | null;
  heard_key: string;
}

export interface VideoRow {
  release_id: number;
  video_id: string;
  src: string;
  title: string;
  duration_seconds: number | null;
  embeddable: number;
  matched_position: string | null;
}

export function rowToRelease(r: ReleaseRow): ReleaseRecord {
  return {
    id: r.id,
    masterId: r.master_id,
    isMainRelease: r.is_main_release === 1,
    title: r.title,
    artists: JSON.parse(r.artists_json) as ArtistRef[],
    artistDisplay: r.artist_display,
    labels: JSON.parse(r.labels_json) as LabelRef[],
    labelName: r.label_name,
    catno: r.catno,
    year: r.year,
    releasedRaw: r.released_raw,
    country: r.country,
    formats: JSON.parse(r.formats_json) as FormatRef[],
    isVinyl: r.is_vinyl === 1,
    genres: JSON.parse(r.genres_json) as string[],
    styles: JSON.parse(r.styles_json) as string[],
    inUniverse: r.in_universe === 1,
    triageKey: r.triage_key,
    snapshot: {
      lowestPrice: r.lowest_price,
      numForSale: r.num_for_sale,
      currency: r.currency,
      communityHave: r.community_have,
      communityWant: r.community_want,
      enrichedAt: r.enriched_at,
    },
    updatedAt: r.updated_at,
  };
}

export function rowToTrack(r: TrackRow): TrackRecord {
  return {
    releaseId: r.release_id,
    seq: r.seq,
    position: r.position,
    title: r.title,
    artists: JSON.parse(r.artists_json) as ArtistRef[],
    artistDisplay: r.artist_display,
    durationSeconds: r.duration_seconds,
    heardKey: r.heard_key,
  };
}

export function rowToVideo(r: VideoRow): VideoRecord {
  return {
    releaseId: r.release_id,
    videoId: r.video_id,
    src: r.src,
    title: r.title,
    durationSeconds: r.duration_seconds,
    embeddable: r.embeddable === 1,
    matchedPosition: r.matched_position,
  };
}

const UPSERT_RELEASE = `
INSERT INTO releases (
  id, master_id, is_main_release, title, artists_json, artist_display, labels_json, label_name, catno,
  year, released_raw, country, formats_json, is_vinyl, genres_json, styles_json, in_universe, triage_key, updated_at
) VALUES (
  @id, @master_id, @is_main_release, @title, @artists_json, @artist_display, @labels_json, @label_name, @catno,
  @year, @released_raw, @country, @formats_json, @is_vinyl, @genres_json, @styles_json, @in_universe, @triage_key, @updated_at
)
ON CONFLICT(id) DO UPDATE SET
  master_id = excluded.master_id,
  is_main_release = excluded.is_main_release,
  title = excluded.title,
  artists_json = excluded.artists_json,
  artist_display = excluded.artist_display,
  labels_json = excluded.labels_json,
  label_name = excluded.label_name,
  catno = excluded.catno,
  year = excluded.year,
  released_raw = excluded.released_raw,
  country = excluded.country,
  formats_json = excluded.formats_json,
  is_vinyl = excluded.is_vinyl,
  genres_json = excluded.genres_json,
  styles_json = excluded.styles_json,
  in_universe = excluded.in_universe,
  triage_key = excluded.triage_key,
  updated_at = excluded.updated_at`;

const INSERT_STUB =
  UPSERT_RELEASE.slice(0, UPSERT_RELEASE.indexOf("ON CONFLICT")) + "ON CONFLICT(id) DO NOTHING";

const INSERT_TRACK = `
INSERT INTO tracks (release_id, seq, position, title, artists_json, artist_display, duration_seconds, heard_key)
VALUES (@release_id, @seq, @position, @title, @artists_json, @artist_display, @duration_seconds, @heard_key)`;

const INSERT_VIDEO = `
INSERT INTO videos (release_id, video_id, src, title, duration_seconds, embeddable, matched_position)
VALUES (@release_id, @video_id, @src, @title, @duration_seconds, @embeddable, @matched_position)
ON CONFLICT(release_id, video_id) DO UPDATE SET
  src = excluded.src, title = excluded.title, duration_seconds = excluded.duration_seconds,
  embeddable = excluded.embeddable, matched_position = excluded.matched_position`;

function releaseParams(w: ReleaseWrite, now: string) {
  return {
    id: w.id,
    master_id: w.masterId,
    is_main_release: w.isMainRelease ? 1 : 0,
    title: w.title,
    artists_json: JSON.stringify(w.artists),
    artist_display: w.artistDisplay,
    labels_json: JSON.stringify(w.labels),
    label_name: w.labelName,
    catno: w.catno,
    year: w.year,
    released_raw: w.releasedRaw,
    country: w.country,
    formats_json: JSON.stringify(w.formats),
    is_vinyl: w.isVinyl ? 1 : 0,
    genres_json: JSON.stringify(w.genres),
    styles_json: JSON.stringify(w.styles),
    in_universe: w.inUniverse ? 1 : 0,
    triage_key: w.triageKey,
    updated_at: now,
  };
}

export function writeTracks(db: Db, releaseId: number, tracks: TrackWrite[]): void {
  db.prepare("DELETE FROM tracks WHERE release_id = ?").run(releaseId);
  const ins = db.prepare(INSERT_TRACK);
  for (const t of tracks) {
    ins.run({
      release_id: releaseId,
      seq: t.seq,
      position: t.position,
      title: t.title,
      artists_json: JSON.stringify(t.artists),
      artist_display: t.artistDisplay,
      duration_seconds: t.durationSeconds,
      heard_key: t.heardKey,
    });
  }
}

export function writeVideos(
  db: Db,
  releaseId: number,
  videos: VideoWrite[],
  opts: { replace: boolean },
): void {
  if (opts.replace) db.prepare("DELETE FROM videos WHERE release_id = ?").run(releaseId);
  const ins = db.prepare(INSERT_VIDEO);
  for (const v of videos) {
    ins.run({
      release_id: releaseId,
      video_id: v.videoId,
      src: v.src,
      title: v.title,
      duration_seconds: v.durationSeconds,
      embeddable: v.embeddable ? 1 : 0,
      matched_position: v.matchedPosition,
    });
  }
}

/** Full upsert from the dump: release columns, tracks and videos are replaced; API snapshot columns are kept. */
export function upsertRelease(db: Db, w: ReleaseWrite): void {
  const now = nowIso();
  db.prepare(UPSERT_RELEASE).run(releaseParams(w, now));
  writeTracks(db, w.id, w.tracks);
  writeVideos(db, w.id, w.videos, { replace: true });
}

export const writeReleases = (db: Db, writes: ReleaseWrite[]): void => {
  db.transaction((rows: ReleaseWrite[]) => {
    for (const w of rows) upsertRelease(db, w);
  })(writes);
};

/** Stub row for a release outside the universe (from a seed). Never overwrites an existing row. */
export function insertStubRelease(db: Db, w: ReleaseWrite): boolean {
  const info = db.prepare(INSERT_STUB).run(releaseParams({ ...w, inUniverse: false }, nowIso()));
  return info.changes > 0;
}

export function getRelease(db: Db, id: number): ReleaseRecord | null {
  const row = db.prepare("SELECT * FROM releases WHERE id = ?").get(id) as ReleaseRow | undefined;
  return row ? rowToRelease(row) : null;
}

export function getTracks(db: Db, releaseId: number): TrackRecord[] {
  const rows = db
    .prepare("SELECT * FROM tracks WHERE release_id = ? ORDER BY seq")
    .all(releaseId) as TrackRow[];
  return rows.map(rowToTrack);
}

export function getVideos(db: Db, releaseId: number): VideoRecord[] {
  const rows = db
    .prepare("SELECT * FROM videos WHERE release_id = ? ORDER BY rowid")
    .all(releaseId) as VideoRow[];
  return rows.map(rowToVideo);
}

export function getSiblings(db: Db, release: ReleaseRecord): ReleaseRecord[] {
  if (release.masterId === null) return [];
  const rows = db
    .prepare(
      "SELECT * FROM releases WHERE master_id = ? AND id != ? ORDER BY is_main_release DESC, year, id",
    )
    .all(release.masterId, release.id) as ReleaseRow[];
  return rows.map(rowToRelease);
}

export function countVideos(db: Db, releaseId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM videos WHERE release_id = ?")
    .get(releaseId) as { n: number };
  return row.n;
}

export interface SnapshotWrite {
  lowestPrice: number | null;
  numForSale: number | null;
  currency: string | null;
  communityHave: number | null;
  communityWant: number | null;
}

export function writeSnapshot(db: Db, releaseId: number, s: SnapshotWrite): void {
  db.prepare(
    `UPDATE releases SET lowest_price = @lowest_price, num_for_sale = @num_for_sale, currency = @currency,
     community_have = @community_have, community_want = @community_want, enriched_at = @enriched_at WHERE id = @id`,
  ).run({
    id: releaseId,
    lowest_price: s.lowestPrice,
    num_for_sale: s.numForSale,
    currency: s.currency,
    community_have: s.communityHave,
    community_want: s.communityWant,
    enriched_at: nowIso(),
  });
}
