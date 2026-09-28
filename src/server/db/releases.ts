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

export function rowToRelease(row: ReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    masterId: row.master_id,
    isMainRelease: row.is_main_release === 1,
    title: row.title,
    artists: JSON.parse(row.artists_json) as ArtistRef[],
    artistDisplay: row.artist_display,
    labels: JSON.parse(row.labels_json) as LabelRef[],
    labelName: row.label_name,
    catno: row.catno,
    year: row.year,
    releasedRaw: row.released_raw,
    country: row.country,
    formats: JSON.parse(row.formats_json) as FormatRef[],
    isVinyl: row.is_vinyl === 1,
    genres: JSON.parse(row.genres_json) as string[],
    styles: JSON.parse(row.styles_json) as string[],
    inUniverse: row.in_universe === 1,
    triageKey: row.triage_key,
    snapshot: {
      lowestPrice: row.lowest_price,
      numForSale: row.num_for_sale,
      currency: row.currency,
      communityHave: row.community_have,
      communityWant: row.community_want,
      enrichedAt: row.enriched_at,
    },
    updatedAt: row.updated_at,
  };
}

export function rowToTrack(row: TrackRow): TrackRecord {
  return {
    releaseId: row.release_id,
    seq: row.seq,
    position: row.position,
    title: row.title,
    artists: JSON.parse(row.artists_json) as ArtistRef[],
    artistDisplay: row.artist_display,
    durationSeconds: row.duration_seconds,
    heardKey: row.heard_key,
  };
}

export function rowToVideo(row: VideoRow): VideoRecord {
  return {
    releaseId: row.release_id,
    videoId: row.video_id,
    src: row.src,
    title: row.title,
    durationSeconds: row.duration_seconds,
    embeddable: row.embeddable === 1,
    matchedPosition: row.matched_position,
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

function releaseParams(release: ReleaseWrite, now: string) {
  return {
    id: release.id,
    master_id: release.masterId,
    is_main_release: release.isMainRelease ? 1 : 0,
    title: release.title,
    artists_json: JSON.stringify(release.artists),
    artist_display: release.artistDisplay,
    labels_json: JSON.stringify(release.labels),
    label_name: release.labelName,
    catno: release.catno,
    year: release.year,
    released_raw: release.releasedRaw,
    country: release.country,
    formats_json: JSON.stringify(release.formats),
    is_vinyl: release.isVinyl ? 1 : 0,
    genres_json: JSON.stringify(release.genres),
    styles_json: JSON.stringify(release.styles),
    in_universe: release.inUniverse ? 1 : 0,
    triage_key: release.triageKey,
    updated_at: now,
  };
}

export function writeTracks(db: Db, releaseId: number, tracks: TrackWrite[]): void {
  db.prepare("DELETE FROM tracks WHERE release_id = ?").run(releaseId);
  const ins = db.prepare(INSERT_TRACK);
  for (const track of tracks) {
    ins.run({
      release_id: releaseId,
      seq: track.seq,
      position: track.position,
      title: track.title,
      artists_json: JSON.stringify(track.artists),
      artist_display: track.artistDisplay,
      duration_seconds: track.durationSeconds,
      heard_key: track.heardKey,
    });
  }
}

export function writeVideos(
  db: Db,
  releaseId: number,
  videos: VideoWrite[],
  options: { replace: boolean },
): void {
  if (options.replace) db.prepare("DELETE FROM videos WHERE release_id = ?").run(releaseId);
  const ins = db.prepare(INSERT_VIDEO);
  for (const video of videos) {
    ins.run({
      release_id: releaseId,
      video_id: video.videoId,
      src: video.src,
      title: video.title,
      duration_seconds: video.durationSeconds,
      embeddable: video.embeddable ? 1 : 0,
      matched_position: video.matchedPosition,
    });
  }
}

/** Full upsert from the dump: release columns, tracks and videos are replaced; API snapshot columns are kept. */
export function upsertRelease(db: Db, release: ReleaseWrite): void {
  const now = nowIso();
  db.prepare(UPSERT_RELEASE).run(releaseParams(release, now));
  writeTracks(db, release.id, release.tracks);
  writeVideos(db, release.id, release.videos, { replace: true });
}

export const writeReleases = (db: Db, writes: ReleaseWrite[]): void => {
  db.transaction((rows: ReleaseWrite[]) => {
    for (const release of rows) upsertRelease(db, release);
  })(writes);
};

/** Stub row for a release outside the universe (from a seed). Never overwrites an existing row. */
export function insertStubRelease(db: Db, release: ReleaseWrite): boolean {
  const info = db
    .prepare(INSERT_STUB)
    .run(releaseParams({ ...release, inUniverse: false }, nowIso()));
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
