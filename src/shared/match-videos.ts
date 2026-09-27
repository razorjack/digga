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

const MATCH_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.85;

function scorePair(track: MatchTrack, videoTitle: string, videoTokens: Set<string>): number {
  const nt = normalizeText(track.title);
  if (nt === "") return 0;
  let score = 0;
  if (nt.length >= 3 && videoTitle.includes(nt)) {
    score = 0.6 + 0.4 * (nt.length / Math.max(videoTitle.length, nt.length));
  } else {
    const tt = tokens(track.title);
    if (tt.length === 0) return 0;
    const hit = tt.filter((t) => videoTokens.has(t)).length;
    score = 0.9 * (hit / tt.length);
    // Penalise titles that are only a subset of a longer track title (e.g. the remix vs the original).
    const extra = [...videoTokens].filter((t) => !tt.includes(t)).length;
    if (hit === tt.length && extra > tt.length * 2) score -= 0.1;
  }
  if (track.position !== "") {
    const pos = normalizeText(track.position);
    if (pos !== "" && videoTokens.has(pos)) score += 0.15;
  }
  if (track.artist) {
    const at = tokens(track.artist);
    if (at.length > 0 && at.every((t) => videoTokens.has(t))) score += 0.1;
  }
  return Math.min(score, 1);
}

/**
 * Maps each video to the track position it most likely plays. Pure and deterministic:
 * one-to-one greedy assignment by score, then leftover videos may duplicate a position
 * when the match is near-certain (two uploads of the same tune).
 */
export function matchVideos(tracks: MatchTrack[], videos: MatchVideo[]): VideoMatch[] {
  const candidates = tracks.filter((t) => t.position !== "" && t.title.trim() !== "");
  const prepared = videos.map((v) => {
    const nv = normalizeText(v.title);
    return { nv, tokens: new Set(tokens(v.title)) };
  });
  const pairs: { v: number; t: number; score: number }[] = [];
  prepared.forEach((pv, v) => {
    candidates.forEach((track, t) => {
      const score = scorePair(track, pv.nv, pv.tokens);
      if (score >= MATCH_THRESHOLD) pairs.push({ v, t, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.v - b.v || a.t - b.t);

  const result: VideoMatch[] = videos.map((_, i) => ({ videoIndex: i, position: null, score: 0 }));
  const usedTracks = new Set<number>();
  const usedVideos = new Set<number>();
  for (const p of pairs) {
    if (usedVideos.has(p.v) || usedTracks.has(p.t)) continue;
    usedVideos.add(p.v);
    usedTracks.add(p.t);
    result[p.v] = { videoIndex: p.v, position: candidates[p.t]!.position, score: p.score };
  }
  for (const p of pairs) {
    if (usedVideos.has(p.v) || p.score < DUPLICATE_THRESHOLD) continue;
    usedVideos.add(p.v);
    result[p.v] = { videoIndex: p.v, position: candidates[p.t]!.position, score: p.score };
  }
  return result;
}
