import { prepareVideos } from "../shared/videos.ts";
import type { Db } from "./db/db.ts";
import { requeueNoAudio } from "./queue/no-audio.ts";
import { getRelease, getTracks, writeSnapshot, writeVideos } from "./db/releases.ts";
import { DiscogsApiError, type DiscogsClient } from "./discogs/client.ts";
import type { DiscogsRelease } from "./discogs/types.ts";
import type { Logger } from "./logger.ts";

/**
 * Enrichment fetches one release from the API for what the dump lacks: price, copies for sale,
 * have/want and the current videos. `P` in Triage asks for it for the record on screen.
 */
export interface EnrichDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

/** Writes the API snapshot and refreshes videos (the dump can be months stale). */
export function applyEnrichment(
  db: Db,
  releaseId: number,
  release: DiscogsRelease,
  currency: string | null = null,
): void {
  db.transaction(() => {
    writeSnapshot(db, releaseId, {
      lowestPrice: release.lowest_price ?? null,
      numForSale: release.num_for_sale ?? null,
      currency,
      communityHave: release.community?.have ?? null,
      communityWant: release.community?.want ?? null,
    });
    if (Array.isArray(release.videos)) {
      const tracks = getTracks(db, releaseId);
      const videos = prepareVideos(
        tracks.map((track) => ({
          position: track.position,
          title: track.title,
          artist: track.artistDisplay,
        })),
        release.videos.map((video) => ({
          src: video.uri,
          title: video.title ?? "",
          durationSeconds: video.duration ?? null,
          embeddable: video.embed !== false,
        })),
      );
      writeVideos(db, releaseId, videos, { replace: true });
    }
  })();
}

/** Fetches one release from Discogs and stores its market data and videos. False on failure. */
export async function enrichRelease(
  deps: EnrichDeps,
  releaseId: number,
  currency: string,
): Promise<boolean> {
  try {
    const release = await deps.discogs.getRelease(releaseId, currency);
    applyEnrichment(deps.db, releaseId, release, currency);
    requeueWithNewVideos(deps, releaseId);
    return true;
  } catch (error) {
    if (error instanceof DiscogsApiError && (error.status === 401 || error.status === 403))
      throw error;
    deps.logger.warn(
      `enrich ${releaseId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Fresh videos may give a record marked no_audio something to play. */
function requeueWithNewVideos(deps: EnrichDeps, releaseId: number): void {
  const key = getRelease(deps.db, releaseId)?.triageKey;
  if (!key) return;
  for (const requeued of requeueNoAudio(deps.db, [key]))
    deps.logger.info(`${requeued} has a new video; back in the queue`);
}
