import { prepareVideos } from "../../shared/videos.ts";
import { TWELVES_STATUSES } from "../../shared/api.ts";
import type { Filters, QueueStrategy } from "../../shared/config.ts";
import type { EnrichProgress } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import { requeueNoAudio } from "../db/no-audio.ts";
import { getRelease, getTracks, writeSnapshot, writeVideos } from "../db/releases.ts";
import { DiscogsApiError, type DiscogsClient } from "../discogs/client.ts";
import type { DiscogsRelease } from "../discogs/types.ts";
import type { Logger } from "../logger.ts";
import { queryQueue } from "../queue/query.ts";
import { releaseIdsToRefresh } from "../queue/twelves.ts";

/** A limit larger than any queue, for enriching every record. */
const EVERY_RECORD = Number.MAX_SAFE_INTEGER;

export interface EnrichDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

export interface EnrichOptions {
  /** How many records to enrich; null enriches every record the job selects. */
  ahead: number | null;
  currency: string;
  signal?: AbortSignal;
}

export interface QueueEnrichOptions extends EnrichOptions {
  filters: Filters;
  strategy: QueueStrategy;
  seed?: number | null;
}

export interface EnrichResult extends EnrichProgress {
  aborted: boolean;
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

/** Enriches the next records in queue order that enrich has not touched yet. */
export async function enrich(
  deps: EnrichDeps,
  options: QueueEnrichOptions,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const items = queryQueue(deps.db, {
    filters: options.filters,
    strategy: options.strategy,
    limit: options.ahead ?? EVERY_RECORD,
    seed: options.seed ?? 0,
    unenrichedOnly: true,
  });
  const result = await enrichReleases(
    deps,
    items.map((item) => item.id),
    options,
    onProgress,
  );
  deps.logger.info(`enrich: ${describeResult(result)}`);
  return result;
}

/** Refreshes the records on the Twelves shelves: never enriched first, then the oldest data. */
export async function enrichTwelves(
  deps: EnrichDeps,
  options: EnrichOptions,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const releaseIds = releaseIdsToRefresh(deps.db, TWELVES_STATUSES, options.ahead ?? EVERY_RECORD);
  const result = await enrichReleases(deps, releaseIds, options, onProgress);
  deps.logger.info(`enrich twelves: ${describeResult(result)}`);
  return result;
}

async function enrichReleases(
  deps: EnrichDeps,
  releaseIds: number[],
  options: EnrichOptions,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const progress: EnrichProgress = {
    done: 0,
    total: releaseIds.length,
    currentReleaseId: null,
    failed: 0,
  };
  let aborted = false;
  for (const releaseId of releaseIds) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    progress.currentReleaseId = releaseId;
    onProgress?.({ ...progress });
    if (await enrichRelease(deps, releaseId, options.currency)) progress.done += 1;
    else progress.failed += 1;
  }
  progress.currentReleaseId = null;
  onProgress?.({ ...progress });
  return { ...progress, aborted };
}

function describeResult(result: EnrichResult): string {
  const aborted = result.aborted ? ", aborted" : "";
  return `${result.done}/${result.total} done, ${result.failed} failed${aborted}`;
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
    if (error instanceof DiscogsApiError && error.status === 404)
      markUnavailable(deps.db, releaseId);
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

function markUnavailable(db: Db, releaseId: number): void {
  // A release removed from Discogs should not be retried on every enrichment pass.
  writeSnapshot(db, releaseId, {
    lowestPrice: null,
    numForSale: null,
    currency: null,
    communityHave: null,
    communityWant: null,
  });
}
