import type { Verdict } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { getRelease } from "../db/releases.ts";
import { deleteVerdict, getVerdict, listVerdicts } from "../db/verdicts.ts";
import { releaseVideos } from "./detail.ts";
import { representativeForKey } from "./query.ts";

/** Remembers which videos the player could offer when a record was marked no_audio. */
export function recordNoAudioVideos(db: Db, verdict: Verdict): void {
  saveRecordedVideos(db, verdict.key, playableVideoIds(db, verdict));
}

/**
 * Sends no_audio records back to the queue when the player has a video for them that it did not
 * have when they were marked: from a newer dump, from enrich or pasted by the user. Videos that
 * were there and would not play keep the record off the queue. Returns the keys sent back.
 */
export function requeueNoAudio(db: Db, keys?: string[]): string[] {
  const verdicts = keys ? noAudioVerdicts(db, keys) : listVerdicts(db, ["no_audio"]);
  const requeued: string[] = [];
  db.transaction(() => {
    for (const verdict of verdicts) {
      const playable = playableVideoIds(db, verdict);
      const known = recordedVideoIds(db, verdict.key);
      // A verdict saved before the snapshot existed counts every current video as known.
      if (known === null) {
        saveRecordedVideos(db, verdict.key, playable);
        continue;
      }
      if (!playable.some((videoId) => !known.has(videoId))) continue;
      deleteVerdict(db, verdict.key);
      db.prepare("DELETE FROM no_audio_videos WHERE key = ?").run(verdict.key);
      requeued.push(verdict.key);
    }
  })();
  return requeued;
}

/** The embeddable videos the player gets for the release the verdict was made on. */
function playableVideoIds(db: Db, verdict: Verdict): string[] {
  const releaseId = verdict.releaseId ?? representativeForKey(db, verdict.key)?.id ?? null;
  const release = releaseId === null ? null : getRelease(db, releaseId);
  if (!release) return [];
  return releaseVideos(db, release)
    .filter((video) => video.embeddable)
    .map((video) => video.videoId);
}

function noAudioVerdicts(db: Db, keys: string[]): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const key of keys) {
    const verdict = getVerdict(db, key);
    if (verdict?.status === "no_audio") verdicts.push(verdict);
  }
  return verdicts;
}

function saveRecordedVideos(db: Db, key: string, videoIds: string[]): void {
  db.prepare(
    `INSERT INTO no_audio_videos (key, video_ids_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET video_ids_json = excluded.video_ids_json`,
  ).run(key, JSON.stringify(videoIds));
}

function recordedVideoIds(db: Db, key: string): Set<string> | null {
  const row = db.prepare("SELECT video_ids_json FROM no_audio_videos WHERE key = ?").get(key) as
    | { video_ids_json: string }
    | undefined;
  return row ? new Set(JSON.parse(row.video_ids_json) as string[]) : null;
}
