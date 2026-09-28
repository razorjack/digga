import type {
  HeardTrack,
  TrackMark,
  TrackVerdict,
  Verdict,
  VerdictSource,
  VerdictStatus,
} from "../../shared/types.ts";
import { VERDICT_STATUSES } from "../../shared/types.ts";
import { seedRank } from "../../shared/verdict-rank.ts";
import { type Db, nowIso } from "./db.ts";

interface VerdictRow {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes: string | null;
  release_id: number | null;
  decided_at: string;
}

interface TrackVerdictRow {
  release_id: number;
  position: string;
  mark: TrackMark;
  notes: string | null;
  decided_at: string;
}

interface HeardRow {
  heard_key: string;
  first_release_id: number;
  seconds_listened: number;
  first_heard_at: string;
  last_heard_at: string;
}

const rowToVerdict = (row: VerdictRow): Verdict => ({
  key: row.key,
  status: row.status,
  source: row.source,
  notes: row.notes,
  releaseId: row.release_id,
  decidedAt: row.decided_at,
});

const rowToTrackVerdict = (row: TrackVerdictRow): TrackVerdict => ({
  releaseId: row.release_id,
  position: row.position,
  mark: row.mark,
  notes: row.notes,
  decidedAt: row.decided_at,
});

export interface VerdictWrite {
  key: string;
  status: VerdictStatus;
  source: VerdictSource;
  notes?: string | null;
  releaseId?: number | null;
  decidedAt?: string;
}

export function getVerdict(db: Db, key: string): Verdict | null {
  const row = db.prepare("SELECT * FROM verdicts WHERE key = ?").get(key) as VerdictRow | undefined;
  return row ? rowToVerdict(row) : null;
}

export function getVerdicts(db: Db, keys: string[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const statement = db.prepare("SELECT * FROM verdicts WHERE key = ?");
  for (const key of keys) {
    const row = statement.get(key) as VerdictRow | undefined;
    if (row) out.set(key, rowToVerdict(row));
  }
  return out;
}

/** Unconditional write (triage and manual decisions). */
export function upsertVerdict(db: Db, verdict: VerdictWrite): Verdict {
  db.prepare(
    `INSERT INTO verdicts (key, status, source, notes, release_id, decided_at)
     VALUES (@key, @status, @source, @notes, @release_id, @decided_at)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, source = excluded.source, notes = excluded.notes,
       release_id = excluded.release_id, decided_at = excluded.decided_at`,
  ).run({
    key: verdict.key,
    status: verdict.status,
    source: verdict.source,
    notes: verdict.notes ?? null,
    release_id: verdict.releaseId ?? null,
    decided_at: verdict.decidedAt ?? nowIso(),
  });
  return getVerdict(db, verdict.key)!;
}

export function applySeedVerdict(
  db: Db,
  verdict: VerdictWrite,
): { written: boolean; previous: Verdict | null } {
  const previous = getVerdict(db, verdict.key);
  if (previous && seedRank(verdict) < seedRank(previous)) return { written: false, previous };
  if (
    previous &&
    previous.status === verdict.status &&
    previous.source === verdict.source &&
    previous.decidedAt === (verdict.decidedAt ?? previous.decidedAt)
  ) {
    return { written: false, previous };
  }
  upsertVerdict(db, verdict);
  return { written: true, previous };
}

export function deleteVerdict(db: Db, key: string): Verdict | null {
  const previous = getVerdict(db, key);
  if (!previous) return null;
  db.prepare("DELETE FROM verdicts WHERE key = ?").run(key);
  return previous;
}

export function countVerdictsByStatus(db: Db): Record<VerdictStatus, number> {
  const counts = Object.fromEntries(VERDICT_STATUSES.map((s) => [s, 0])) as Record<
    VerdictStatus,
    number
  >;
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM verdicts GROUP BY status").all() as {
    status: VerdictStatus;
    n: number;
  }[];
  for (const row of rows) if (row.status in counts) counts[row.status] = row.n;
  return counts;
}

export function listVerdicts(db: Db, statuses: VerdictStatus[]): Verdict[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM verdicts WHERE status IN (${placeholders}) ORDER BY decided_at DESC`)
    .all(...statuses) as VerdictRow[];
  return rows.map(rowToVerdict);
}

/** Verdicts made in Digga (triage or manual): the "dug" count. */
export function countDug(db: Db): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM verdicts WHERE source IN ('triage', 'manual')").get() as {
      n: number;
    }
  ).n;
}

/** Timestamps of triage decisions, oldest first, for the rate/ETA estimate. */
export function triageDecisionTimes(db: Db, limit = 5000): string[] {
  const rows = db
    .prepare(
      "SELECT decided_at FROM verdicts WHERE source IN ('triage', 'manual') ORDER BY decided_at DESC LIMIT ?",
    )
    .all(limit) as { decided_at: string }[];
  return rows.map((row) => row.decided_at).reverse();
}

export function setTrackVerdict(
  db: Db,
  input: { releaseId: number; position: string; mark: TrackMark | null; notes?: string | null },
): TrackVerdict | null {
  if (input.mark === null) {
    db.prepare("DELETE FROM track_verdicts WHERE release_id = ? AND position = ?").run(
      input.releaseId,
      input.position,
    );
    return null;
  }
  db.prepare(
    `INSERT INTO track_verdicts (release_id, position, mark, notes, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(release_id, position) DO UPDATE SET mark = excluded.mark, notes = excluded.notes, decided_at = excluded.decided_at`,
  ).run(input.releaseId, input.position, input.mark, input.notes ?? null, nowIso());
  const row = db
    .prepare("SELECT * FROM track_verdicts WHERE release_id = ? AND position = ?")
    .get(input.releaseId, input.position) as TrackVerdictRow;
  return rowToTrackVerdict(row);
}

export function getTrackVerdicts(db: Db, releaseId: number): TrackVerdict[] {
  const rows = db
    .prepare("SELECT * FROM track_verdicts WHERE release_id = ? ORDER BY position")
    .all(releaseId) as TrackVerdictRow[];
  return rows.map(rowToTrackVerdict);
}

export function getHeardKeys(db: Db, heardKeys: string[]): Set<string> {
  const out = new Set<string>();
  const statement = db.prepare("SELECT heard_key FROM heard_tracks WHERE heard_key = ?");
  for (const key of heardKeys) if (statement.get(key)) out.add(key);
  return out;
}

export function countHeardTracks(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM heard_tracks").get() as { n: number }).n;
}

/** Appends to listen_log and, when the position maps to a track, accumulates heard_tracks. */
export function logListen(
  db: Db,
  input: { releaseId: number; position: string | null; videoId: string; seconds: number },
): { id: number; heardKey: string | null; heard: HeardTrack | null } {
  const at = nowIso();
  let heardKey: string | null = null;
  if (input.position !== null && input.position !== "") {
    const track = db
      .prepare(
        "SELECT heard_key FROM tracks WHERE release_id = ? AND position = ? ORDER BY seq LIMIT 1",
      )
      .get(input.releaseId, input.position) as { heard_key: string } | undefined;
    heardKey = track?.heard_key ?? null;
  }
  const write = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO listen_log (release_id, position, video_id, seconds, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(input.releaseId, input.position, input.videoId, input.seconds, at);
    if (heardKey !== null) {
      db.prepare(
        `INSERT INTO heard_tracks (heard_key, first_release_id, seconds_listened, first_heard_at, last_heard_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(heard_key) DO UPDATE SET seconds_listened = seconds_listened + excluded.seconds_listened,
           last_heard_at = excluded.last_heard_at`,
      ).run(heardKey, input.releaseId, input.seconds, at, at);
    }
    return Number(info.lastInsertRowid);
  });
  const id = write();
  const heard = heardKey
    ? (db.prepare("SELECT * FROM heard_tracks WHERE heard_key = ?").get(heardKey) as
        | HeardRow
        | undefined)
    : undefined;
  return {
    id,
    heardKey,
    heard: heard
      ? {
          heardKey: heard.heard_key,
          firstReleaseId: heard.first_release_id,
          secondsListened: heard.seconds_listened,
          firstHeardAt: heard.first_heard_at,
          lastHeardAt: heard.last_heard_at,
        }
      : null,
  };
}
