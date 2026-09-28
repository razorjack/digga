import type { ExportedRelease, TrackMarkExport, VerdictExport } from "../../shared/api.ts";
import type { TrackMark, VerdictSource, VerdictStatus } from "../../shared/types.ts";
import type { Db } from "./db.ts";

interface ReleaseColumns {
  release_id: number | null;
  artist_display: string | null;
  title: string | null;
  label_name: string | null;
  catno: string | null;
  year: number | null;
  country: string | null;
}

interface VerdictExportRow extends ReleaseColumns {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes: string | null;
  decided_at: string;
}

interface TrackMarkExportRow extends ReleaseColumns {
  mark_release_id: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decided_at: string;
  track_artist: string | null;
  track_title: string | null;
}

const RELEASE_COLUMNS =
  "r.id AS release_id, r.artist_display, r.title, r.label_name, r.catno, r.year, r.country";

/** Every verdict, oldest first, with the release it was made on (or its record's main release). */
export function listVerdictExports(db: Db): VerdictExport[] {
  const rows = db
    .prepare(
      `SELECT v.key, v.status, v.source, v.notes, v.decided_at, ${RELEASE_COLUMNS}
       FROM verdicts v
       LEFT JOIN releases r ON r.id = COALESCE(v.release_id, (
         SELECT k.id FROM releases k WHERE k.triage_key = v.key
         ORDER BY k.is_main_release DESC, k.id LIMIT 1))
       ORDER BY v.decided_at, v.key`,
    )
    .all() as VerdictExportRow[];
  return rows.map((row) => ({
    key: row.key,
    status: row.status,
    source: row.source,
    notes: row.notes,
    decidedAt: row.decided_at,
    ...exportedRelease(row),
  }));
}

/** Every track mark, oldest first, with its track and release. */
export function listTrackMarkExports(db: Db): TrackMarkExport[] {
  const rows = db
    .prepare(
      `SELECT tv.release_id AS mark_release_id, tv.position, tv.mark, tv.notes, tv.decided_at,
         t.artist_display AS track_artist, t.title AS track_title, ${RELEASE_COLUMNS}
       FROM track_verdicts tv
       LEFT JOIN releases r ON r.id = tv.release_id
       LEFT JOIN tracks t ON t.release_id = tv.release_id AND t.seq = (
         SELECT MIN(s.seq) FROM tracks s WHERE s.release_id = tv.release_id AND s.position = tv.position)
       ORDER BY tv.decided_at, tv.release_id, tv.position`,
    )
    .all() as TrackMarkExportRow[];
  return rows.map((row) => ({
    ...exportedRelease(row),
    releaseId: row.mark_release_id,
    position: row.position,
    mark: row.mark,
    notes: row.notes,
    decidedAt: row.decided_at,
    trackArtist: row.track_artist,
    trackTitle: row.track_title,
  }));
}

function exportedRelease(row: ReleaseColumns): ExportedRelease {
  return {
    releaseId: row.release_id,
    artist: row.artist_display,
    title: row.title,
    label: row.label_name,
    catno: row.catno,
    year: row.year,
    country: row.country,
  };
}
