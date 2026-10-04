import { normalizeText, tokens } from "./normalize.ts";

export interface MatchTrack {
  position: string;
  title: string;
  /** Artist credited on the track (or the release artist). Improves tie-breaking. */
  artist?: string;
}

export interface MatchVideo {
  title: string;
}
export interface VideoMatch {
  videoIndex: number;
  position: string | null;
  score: number;
}
interface ScoredPair {
  videoIndex: number;
  trackIndex: number;
  score: number;
}
/**
 * The rules matchVideos() follows. A library whose videos were matched by older rules is
 * rematched when it opens (`src/server/db/video-matches.ts`).
 */
export const VIDEO_MATCH_VERSION = 2;

const MATCH_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.85;
/** Shorter titles found inside run-together words would match by accident. */
const MIN_JOINED_TITLE_LENGTH = 6;

function titleScore(trackTitle: string, videoTitle: string, videoTokens: Set<string>): number {
  const normalized = normalizeText(trackTitle);
  if (normalized === "") return 0;
  if (normalized.length >= 3 && videoTitle.includes(normalized)) {
    return 0.6 + 0.4 * (normalized.length / Math.max(videoTitle.length, normalized.length));
  }
  return Math.max(
    joinedTitleScore(normalized, videoTitle),
    tokenScore(tokens(trackTitle), videoTokens),
  );
}

function tokenScore(trackTokens: string[], videoTokens: Set<string>): number {
  if (trackTokens.length === 0) return 0;
  const matches = trackTokens.filter((token) => videoTokens.has(token)).length;
  let score = 0.9 * (matches / trackTokens.length);
  // A remix title containing the original title alone is weaker evidence.
  const extra = [...videoTokens].filter((token) => !trackTokens.includes(token)).length;
  if (matches === trackTokens.length && extra > trackTokens.length * 2) score -= 0.1;
  return score;
}

/** "Cover Girl" in "Outfit - Covergirl": the title found once the spaces are dropped from both. */
function joinedTitleScore(trackTitle: string, videoTitle: string): number {
  const joinedTrack = trackTitle.replaceAll(" ", "");
  const joinedVideo = videoTitle.replaceAll(" ", "");
  if (joinedTrack.length < MIN_JOINED_TITLE_LENGTH || !joinedVideo.includes(joinedTrack)) return 0;
  return 0.55 + 0.35 * (joinedTrack.length / joinedVideo.length);
}

/** "The Outfit" is credited as "Outfit" in many video titles. */
function artistTokensOf(artist: string): string[] {
  const artistTokens = tokens(artist);
  return artistTokens.length > 1 && artistTokens[0] === "the"
    ? artistTokens.slice(1)
    : artistTokens;
}

function scorePair(track: MatchTrack, videoTitle: string, videoTokens: Set<string>): number {
  if (normalizeText(track.title) === "") return 0;
  let score = titleScore(track.title, videoTitle, videoTokens);
  const position = normalizeText(track.position);
  if (position !== "" && videoTokens.has(position)) score += 0.15;
  const artistTokens = artistTokensOf(track.artist ?? "");
  if (artistTokens.length > 0 && artistTokens.every((token) => videoTokens.has(token)))
    score += 0.1;
  return Math.min(score, 1);
}

function scoreCandidates(tracks: MatchTrack[], videos: MatchVideo[]): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  videos.forEach((video, videoIndex) => {
    const title = normalizeText(video.title);
    const videoTokens = new Set(tokens(video.title));
    tracks.forEach((track, trackIndex) => {
      const score = scorePair(track, title, videoTokens);
      if (score >= MATCH_THRESHOLD) pairs.push({ videoIndex, trackIndex, score });
    });
  });
  return pairs.sort(
    (left, right) =>
      right.score - left.score ||
      left.videoIndex - right.videoIndex ||
      left.trackIndex - right.trackIndex,
  );
}

/** Greedy one-to-one matching, followed by near-certain duplicate uploads of a matched tune. */
export function matchVideos(tracks: MatchTrack[], videos: MatchVideo[]): VideoMatch[] {
  const candidates = tracks.filter((track) => track.position !== "" && track.title.trim() !== "");
  const pairs = scoreCandidates(candidates, videos);
  const result: VideoMatch[] = videos.map((_, videoIndex) => ({
    videoIndex,
    position: null,
    score: 0,
  }));
  const usedTracks = new Set<number>();
  const usedVideos = new Set<number>();
  for (const pair of pairs) {
    if (usedVideos.has(pair.videoIndex) || usedTracks.has(pair.trackIndex)) continue;
    usedVideos.add(pair.videoIndex);
    usedTracks.add(pair.trackIndex);
    result[pair.videoIndex] = assignedMatch(pair, candidates);
  }
  for (const pair of pairs) {
    if (usedVideos.has(pair.videoIndex) || pair.score < DUPLICATE_THRESHOLD) continue;
    usedVideos.add(pair.videoIndex);
    result[pair.videoIndex] = assignedMatch(pair, candidates);
  }
  return result;
}

function assignedMatch(pair: ScoredPair, tracks: MatchTrack[]): VideoMatch {
  return {
    videoIndex: pair.videoIndex,
    position: tracks[pair.trackIndex]!.position,
    score: pair.score,
  };
}
