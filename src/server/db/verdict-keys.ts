import { preferredVerdict } from "../../shared/verdict-rank.ts";
import type { Verdict } from "../../shared/types.ts";
import type { Db } from "./db.ts";
import { deleteVerdict, getVerdict, upsertVerdict } from "./verdicts.ts";

/** A verdict whose release a load has put on another record, and that record's key. */
interface Move {
  verdict: Verdict;
  toKey: string;
}

/** A verdict that has to move to the key it won. */
interface Arrival {
  fromKey: string;
  verdict: Verdict;
}

/**
 * Moves the verdicts made on these releases to the key each release has now. A dump load changes
 * a release's key when Discogs gives it a master, moves it to another or takes it off one, and a
 * verdict left on the old key would send the record back to the queue. A verdict follows the
 * release it was made on; verdicts that land on one key merge. Every move is worked out before
 * any is made, so a verdict leaving a key never merges with one arriving there, as when two
 * releases swap masters. Returns how many verdicts moved.
 */
export function moveVerdictsToReleaseKeys(db: Db, releaseIds: number[]): number {
  const moves = readMoves(db, releaseIds);
  const leavingKeys = new Set(moves.map((move) => move.verdict.key));

  const arrivals: Arrival[] = [];
  for (const [toKey, group] of Map.groupBy(moves, (move) => move.toKey)) {
    const resident = leavingKeys.has(toKey) ? null : getVerdict(db, toKey);
    const arriving = group.map((move) => move.verdict);
    const arrival = settleDestination(db, toKey, { resident, arriving });
    if (arrival) arrivals.push(arrival);
  }
  placeArrivals(db, arrivals);
  return moves.length;
}

/**
 * The key a verdict belongs on: the record its release is on now, whatever key the page or the
 * backup had; its own key without a release, or for a release the library does not have.
 */
export function recordKeyOf(db: Db, verdict: { key: string; releaseId?: number | null }): string {
  if (verdict.releaseId === null || verdict.releaseId === undefined) return verdict.key;
  return currentReleaseKey(db, verdict.releaseId) ?? verdict.key;
}

/** The key a release has now; null for a release the library does not have. */
function currentReleaseKey(db: Db, releaseId: number): string | null {
  const row = db.prepare("SELECT triage_key FROM releases WHERE id = ?").get(releaseId) as
    | { triage_key: string }
    | undefined;
  return row?.triage_key ?? null;
}

function readMoves(db: Db, releaseIds: number[]): Move[] {
  const rows = db
    .prepare(
      `SELECT v.key, r.triage_key AS to_key FROM verdicts v JOIN releases r ON r.id = v.release_id
       WHERE v.release_id IN (SELECT value FROM json_each(?)) AND v.key <> r.triage_key`,
    )
    .all(JSON.stringify(releaseIds)) as { key: string; to_key: string }[];
  return rows.map((row) => ({ verdict: getVerdict(db, row.key)!, toKey: row.to_key }));
}

/**
 * Decides which verdict the key keeps, the higher rank and then the newer decision, and deletes
 * the others with their no-audio videos; the log keeps them. Returns the arriving verdict that
 * still has to move to the key; null when the verdict there stays.
 */
function settleDestination(
  db: Db,
  toKey: string,
  verdicts: { resident: Verdict | null; arriving: Verdict[] },
): Arrival | null {
  const { resident, arriving } = verdicts;
  const candidates = resident ? [resident, ...arriving] : arriving;
  const kept = candidates.reduce((left, right) => preferredVerdict(left, right));

  for (const verdict of candidates) {
    if (verdict === kept) continue;
    deleteVerdict(db, verdict.key);
    forgetNoAudioVideos(db, verdict.key);
  }
  if (kept === resident) return null;
  return { fromKey: kept.key, verdict: { ...kept, key: toKey } };
}

/**
 * Moves each arriving verdict once its key is free, so the log records the move. Verdicts that
 * wait on each other's keys, as two releases that swapped masters, are written anew instead.
 */
function placeArrivals(db: Db, arrivals: Arrival[]): void {
  let waiting = arrivals;
  while (waiting.length > 0) {
    const ready = waiting.filter((arrival) => getVerdict(db, arrival.verdict.key) === null);
    if (ready.length === 0) break;
    for (const arrival of ready) moveVerdict(db, arrival);
    waiting = waiting.filter((arrival) => !ready.includes(arrival));
  }
  rewriteVerdicts(db, waiting);
}

function moveVerdict(db: Db, arrival: Arrival): void {
  const { fromKey, verdict } = arrival;
  db.prepare("UPDATE verdicts SET key = ? WHERE key = ?").run(verdict.key, fromKey);
  forgetNoAudioVideos(db, verdict.key);
  db.prepare("UPDATE no_audio_videos SET key = ? WHERE key = ?").run(verdict.key, fromKey);
}

function rewriteVerdicts(db: Db, arrivals: Arrival[]): void {
  const withVideos = arrivals.map((arrival) => ({
    ...arrival,
    videoIds: noAudioVideosOf(db, arrival.fromKey),
  }));
  for (const { fromKey } of withVideos) {
    deleteVerdict(db, fromKey);
    forgetNoAudioVideos(db, fromKey);
  }
  for (const { verdict, videoIds } of withVideos) {
    upsertVerdict(db, verdict);
    if (videoIds !== null)
      db.prepare("INSERT INTO no_audio_videos (key, video_ids_json) VALUES (?, ?)").run(
        verdict.key,
        videoIds,
      );
  }
}

function noAudioVideosOf(db: Db, key: string): string | null {
  const row = db.prepare("SELECT video_ids_json FROM no_audio_videos WHERE key = ?").get(key) as
    | { video_ids_json: string }
    | undefined;
  return row?.video_ids_json ?? null;
}

function forgetNoAudioVideos(db: Db, key: string): void {
  db.prepare("DELETE FROM no_audio_videos WHERE key = ?").run(key);
}
