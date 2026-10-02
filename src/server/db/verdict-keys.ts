import { preferredVerdict } from "../../shared/verdict-rank.ts";
import type { Verdict } from "../../shared/types.ts";
import type { Db } from "./db.ts";
import { deleteVerdict, getVerdict, upsertVerdict } from "./verdicts.ts";

/**
 * Moves the verdicts made on these releases to the key each release has now. A dump load changes
 * a release's key when Discogs gives it a master, moves it to another or takes it off one, and a
 * verdict left on the old key would send the record back to the queue. A verdict follows the
 * release it was made on; one that lands on a key with a verdict merges with it. Returns how many
 * verdicts moved.
 */
export function moveVerdictsToReleaseKeys(db: Db, releaseIds: number[]): number {
  const keys = db
    .prepare(
      `SELECT v.key FROM verdicts v JOIN releases r ON r.id = v.release_id
       WHERE v.release_id IN (SELECT value FROM json_each(?)) AND v.key <> r.triage_key`,
    )
    .all(JSON.stringify(releaseIds)) as { key: string }[];
  let moved = 0;
  for (const { key } of keys) if (moveVerdict(db, key)) moved += 1;
  return moved;
}

/** The key a release has now; null for a release the library does not have. */
export function currentReleaseKey(db: Db, releaseId: number): string | null {
  const row = db.prepare("SELECT triage_key FROM releases WHERE id = ?").get(releaseId) as
    | { triage_key: string }
    | undefined;
  return row?.triage_key ?? null;
}

/**
 * Moves one verdict to its release's key. It is read again here, since an earlier move in the
 * same pass may have merged into it.
 */
function moveVerdict(db: Db, key: string): boolean {
  const moving = getVerdict(db, key);
  const toKey = moving?.releaseId ? currentReleaseKey(db, moving.releaseId) : null;
  if (!moving || toKey === null || toKey === key) return false;

  const present = getVerdict(db, toKey);
  if (!present) {
    db.prepare("UPDATE verdicts SET key = ? WHERE key = ?").run(toKey, key);
    moveNoAudioVideos(db, key, toKey);
    return true;
  }
  const kept = preferredVerdict(present, moving);
  deleteVerdict(db, key);
  upsertVerdict(db, mergedVerdict(toKey, kept, kept === present ? moving : present));
  if (kept === moving) moveNoAudioVideos(db, key, toKey);
  else db.prepare("DELETE FROM no_audio_videos WHERE key = ?").run(key);
  return true;
}

/**
 * The verdict the key keeps, with the note of the one it replaced and the later of their dug
 * dates, so the record counts as dug when either was.
 */
function mergedVerdict(key: string, kept: Verdict, replaced: Verdict): Verdict {
  return {
    ...kept,
    key,
    notes: joinedNotes(kept.notes, replaced.notes),
    dugAt: laterTime(kept.dugAt, replaced.dugAt),
  };
}

function joinedNotes(kept: string | null, replaced: string | null): string | null {
  if (replaced === null || replaced === kept) return kept;
  if (kept === null) return replaced;
  return `${kept}; ${replaced}`;
}

function laterTime(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

/** The videos a no-audio record had go with its verdict, replacing any the key had. */
function moveNoAudioVideos(db: Db, fromKey: string, toKey: string): void {
  db.prepare("DELETE FROM no_audio_videos WHERE key = ?").run(toKey);
  db.prepare("UPDATE no_audio_videos SET key = ? WHERE key = ?").run(toKey, fromKey);
}
