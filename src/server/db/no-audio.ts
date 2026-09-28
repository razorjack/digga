import type { Verdict } from "../../shared/types.ts";
import type { Db } from "./db.ts";
import { playableVideoIds } from "./releases.ts";
import { deleteVerdict, getVerdict, listVerdicts } from "./verdicts.ts";

/** Remembers which playable videos a record had when it was marked no_audio. */
export function recordNoAudioVideos(db: Db, key: string): void {
  db.prepare(
    `INSERT INTO no_audio_videos (key, video_ids_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET video_ids_json = excluded.video_ids_json`,
  ).run(key, JSON.stringify(playableVideoIds(db, key)));
}

/**
 * Sends no_audio records back to the queue when they have a playable video they did not have
 * when they were marked: from a newer dump, from enrich or pasted by the user. Videos that were
 * there and would not play keep the record off the queue. Returns the keys sent back.
 */
export function requeueNoAudio(db: Db, keys?: string[]): string[] {
  const verdicts = keys ? noAudioVerdicts(db, keys) : listVerdicts(db, ["no_audio"]);
  const requeued: string[] = [];
  db.transaction(() => {
    for (const verdict of verdicts) {
      const known = new Set(recordedVideoIds(db, verdict.key));
      if (!playableVideoIds(db, verdict.key).some((videoId) => !known.has(videoId))) continue;
      deleteVerdict(db, verdict.key);
      db.prepare("DELETE FROM no_audio_videos WHERE key = ?").run(verdict.key);
      requeued.push(verdict.key);
    }
  })();
  return requeued;
}

function noAudioVerdicts(db: Db, keys: string[]): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const key of keys) {
    const verdict = getVerdict(db, key);
    if (verdict?.status === "no_audio") verdicts.push(verdict);
  }
  return verdicts;
}

function recordedVideoIds(db: Db, key: string): string[] {
  const row = db.prepare("SELECT video_ids_json FROM no_audio_videos WHERE key = ?").get(key) as
    | { video_ids_json: string }
    | undefined;
  return row ? (JSON.parse(row.video_ids_json) as string[]) : [];
}
