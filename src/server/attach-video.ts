import { prepareVideos } from "../shared/videos.ts";
import { youtubeWatchUrl } from "../shared/youtube.ts";
import type { ReleaseRecord } from "../shared/types.ts";
import type { Db } from "./db/db.ts";
import { requeueNoAudio } from "./db/no-audio.ts";
import { addUserVideo, getTracks } from "./db/releases.ts";
import type { VideoTitleLookup } from "./youtube.ts";

export interface AttachVideoDeps {
  db: Db;
  lookupTitle: VideoTitleLookup;
}

/**
 * Attaches a YouTube video the user found to a release, matched to a track by the title YouTube
 * gives. A record marked no_audio goes back to the queue with it.
 */
export async function attachVideo(
  deps: AttachVideoDeps,
  release: ReleaseRecord,
  videoId: string,
): Promise<void> {
  const src = youtubeWatchUrl(videoId);
  const title = await deps.lookupTitle(videoId);
  const tracks = getTracks(deps.db, release.id).map((track) => ({
    position: track.position,
    title: track.title,
    artist: track.artistDisplay,
  }));
  const [video] = prepareVideos(tracks, [{ src, title, durationSeconds: null, embeddable: true }]);
  const matchedPosition = video?.matchedPosition ?? null;
  addUserVideo(deps.db, release.id, { videoId, src, title, matchedPosition });
  requeueNoAudio(deps.db, [release.triageKey]);
}
