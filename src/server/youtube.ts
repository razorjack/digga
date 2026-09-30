import { youtubeWatchUrl } from "../shared/youtube.ts";
import type { Logger } from "./logger.ts";

/** Resolves a YouTube video's title, or "" when YouTube does not say. */
export type VideoTitleLookup = (videoId: string) => Promise<string>;

const LOOKUP_TIMEOUT_MS = 4000;
const DEFAULT_OEMBED_URL = "https://www.youtube.com/oembed";

export interface VideoTitleLookupOptions {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** YouTube's oEmbed endpoint unless a stand-in replaces it (tests). */
  baseUrl?: string;
}

/**
 * Reads the title from YouTube's oEmbed endpoint, which needs no API key. The title lets Digga
 * match a pasted link to a track; without one the video still plays, as an unmatched video.
 */
export function createVideoTitleLookup(options: VideoTitleLookupOptions = {}): VideoTitleLookup {
  const { fetchImpl = fetch, logger, baseUrl = DEFAULT_OEMBED_URL } = options;
  return async (videoId) => {
    const url = new URL(baseUrl);
    url.searchParams.set("format", "json");
    url.searchParams.set("url", youtubeWatchUrl(videoId));
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      if (!response.ok) return "";
      const body = (await response.json()) as { title?: unknown };
      return typeof body.title === "string" ? body.title : "";
    } catch (error) {
      logger?.warn(`no title for YouTube video ${videoId}`, error);
      return "";
    }
  };
}
