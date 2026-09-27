import { matchVideos } from "../../shared/match-videos.ts";
import type { Filters, QueueStrategy } from "../../shared/config.ts";
import type { EnrichProgress } from "../../shared/types.ts";
import { youtubeIdFromUrl } from "../../shared/youtube.ts";
import type { Db } from "../db/db.ts";
import { getTracks, type VideoWrite, writeSnapshot, writeVideos } from "../db/releases.ts";
import { DiscogsApiError, type DiscogsClient } from "../discogs/client.ts";
import type { DiscogsRelease } from "../discogs/types.ts";
import type { Logger } from "../logger.ts";
import { queryQueue } from "../queue/query.ts";

export interface EnrichDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

export interface EnrichOptions {
  /** Enrich the next N unenriched items in current queue order. */
  ahead: number;
  currency: string;
  filters: Filters;
  strategy: QueueStrategy;
  seed?: number | null;
  signal?: AbortSignal;
}

export interface EnrichResult extends EnrichProgress {
  aborted: boolean;
}

/** Writes the API snapshot and refreshes videos (the dump can be months stale). */
export function applyEnrichment(db: Db, releaseId: number, rel: DiscogsRelease): void {
  db.transaction(() => {
    writeSnapshot(db, releaseId, {
      lowestPrice: rel.lowest_price ?? null,
      numForSale: rel.num_for_sale ?? null,
      currency: null,
      communityHave: rel.community?.have ?? null,
      communityWant: rel.community?.want ?? null,
    });
    if (Array.isArray(rel.videos)) {
      const tracks = getTracks(db, releaseId);
      const inputs = rel.videos
        .map((v) => ({ v, videoId: youtubeIdFromUrl(v.uri) }))
        .filter(
          (x): x is { v: (typeof rel.videos)[number]; videoId: string } => x.videoId !== null,
        );
      const matches = matchVideos(
        tracks.map((t) => ({ position: t.position, title: t.title, artist: t.artistDisplay })),
        inputs.map((x) => ({ title: x.v.title ?? "" })),
      );
      const seen = new Set<string>();
      const videos: VideoWrite[] = [];
      inputs.forEach((x, i) => {
        if (seen.has(x.videoId)) return;
        seen.add(x.videoId);
        videos.push({
          videoId: x.videoId,
          src: x.v.uri,
          title: x.v.title ?? "",
          durationSeconds: x.v.duration ?? null,
          embeddable: x.v.embed !== false,
          matchedPosition: matches[i]?.position ?? null,
        });
      });
      writeVideos(db, releaseId, videos, { replace: true });
    }
  })();
  db.prepare("UPDATE releases SET currency = ? WHERE id = ?").run(null, releaseId);
}

export async function enrich(
  deps: EnrichDeps,
  opts: EnrichOptions,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const items = queryQueue(deps.db, {
    filters: opts.filters,
    strategy: opts.strategy,
    limit: opts.ahead,
    seed: opts.seed ?? 0,
    unenrichedOnly: true,
  });
  const progress: EnrichProgress = {
    done: 0,
    total: items.length,
    currentReleaseId: null,
    failed: 0,
  };
  let aborted = false;
  for (const item of items) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }
    progress.currentReleaseId = item.id;
    onProgress?.({ ...progress });
    try {
      const rel = await deps.discogs.getRelease(item.id, opts.currency);
      applyEnrichment(deps.db, item.id, rel);
      deps.db.prepare("UPDATE releases SET currency = ? WHERE id = ?").run(opts.currency, item.id);
      progress.done += 1;
    } catch (err) {
      if (err instanceof DiscogsApiError && (err.status === 401 || err.status === 403)) throw err;
      if (err instanceof DiscogsApiError && err.status === 404) {
        // Gone from Discogs: mark as enriched so the job does not retry it forever.
        writeSnapshot(deps.db, item.id, {
          lowestPrice: null,
          numForSale: null,
          currency: null,
          communityHave: null,
          communityWant: null,
        });
      }
      progress.failed += 1;
      deps.logger.warn(
        `enrich ${item.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  progress.currentReleaseId = null;
  onProgress?.({ ...progress });
  deps.logger.info(
    `enrich: ${progress.done}/${progress.total} done, ${progress.failed} failed${aborted ? ", aborted" : ""}`,
  );
  return { ...progress, aborted };
}
