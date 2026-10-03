import { heardKeyFor, TUNE_KEY_VERSION } from "../../shared/normalize.ts";
import type { ArtistRef } from "../../shared/types.ts";
import { withoutChangeLogs } from "./change-logs.ts";
import type { Db } from "./db.ts";

const RELEASES_PER_BATCH = 2000;

/**
 * Brings a library keyed by older tune key rules to TUNE_KEY_VERSION: every track gets its key
 * under the current rules, then the listens and marks follow their tracks. Runs once, as the
 * library opens; a dump load writes current keys itself.
 */
export function rekeyTunes(db: Db): void {
  const saved = db.prepare("SELECT value FROM meta WHERE key = 'tune_key_version'").pluck().get();
  if (Number(saved ?? 1) >= TUNE_KEY_VERSION) return;
  db.transaction(() => {
    rekeyTracks(db);
    remapTuneKeys(db);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tune_key_version', ?)").run(
      String(TUNE_KEY_VERSION),
    );
  })();
}

/**
 * Gives each listen and mark the key of the track now at its position, where that track has the
 * title the listen or mark saved, then rebuilds heard_tracks from the listens. So a record that
 * moved to another master, or a credit Discogs corrected, keeps what was heard and marked, while a
 * position that holds another tune now leaves the saved key alone. Neither change log records it.
 */
export function remapTuneKeys(db: Db): void {
  db.transaction(() => withoutChangeLogs(db, () => remapTables(db)))();
}

function remapTables(db: Db): void {
  for (const table of ["listen_log", "track_verdicts"]) {
    const trackKey = `SELECT t.heard_key FROM tracks t
        WHERE t.release_id = ${table}.release_id AND t.position = ${table}.position
          AND (${table}.title IS NULL OR t.title = ${table}.title)
        ORDER BY t.seq LIMIT 1`;
    db.prepare(
      `UPDATE OR IGNORE ${table} SET heard_key = (${trackKey})
         WHERE position IS NOT NULL AND (${trackKey}) IS NOT NULL`,
    ).run();
  }
  rebuildHeardTracks(db);
}

/** heard_tracks from every listen that counts as heard. */
function rebuildHeardTracks(db: Db): void {
  db.prepare("DELETE FROM heard_tracks").run();
  db.prepare(
    `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at,
       last_heard_at)
     SELECT l.heard_key,
       (SELECT f.release_id FROM listen_log f WHERE f.heard_key = l.heard_key AND f.heard IS NOT 0
        ORDER BY f.at, f.id LIMIT 1),
       SUM(l.seconds), MIN(l.at), MAX(l.at)
     FROM listen_log l WHERE l.heard_key IS NOT NULL AND l.heard IS NOT 0
     GROUP BY l.heard_key`,
  ).run();
}

interface TrackRow {
  releaseId: number;
  seq: number;
  position: string;
  title: string;
  trackArtists: string;
  releaseArtists: string;
  recordKey: string;
}

/** Every track's key under the current rules, a batch of releases at a time. */
function rekeyTracks(db: Db): void {
  const batch = db.prepare("SELECT id FROM releases WHERE id > ? ORDER BY id LIMIT ?").pluck();
  const read = db.prepare(
    `SELECT t.release_id AS releaseId, t.seq, t.position, t.title,
       t.artists_json AS trackArtists, r.artists_json AS releaseArtists, r.triage_key AS recordKey
     FROM tracks t JOIN releases r ON r.id = t.release_id
     WHERE t.release_id BETWEEN ? AND ?`,
  );
  const write = db.prepare("UPDATE tracks SET heard_key = ? WHERE release_id = ? AND seq = ?");
  let releaseIds = batch.all(0, RELEASES_PER_BATCH) as number[];
  while (releaseIds.length > 0) {
    const last = releaseIds.at(-1)!;
    for (const row of read.all(releaseIds[0], last) as TrackRow[])
      write.run(trackKey(row), row.releaseId, row.seq);
    releaseIds = batch.all(last, RELEASES_PER_BATCH) as number[];
  }
}

function trackKey(row: TrackRow): string {
  const trackArtists = JSON.parse(row.trackArtists) as ArtistRef[];
  const artists =
    trackArtists.length > 0 ? trackArtists : (JSON.parse(row.releaseArtists) as ArtistRef[]);
  return heardKeyFor({
    artists,
    title: row.title,
    recordKey: row.recordKey,
    position: row.position,
  });
}
