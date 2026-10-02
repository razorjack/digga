import type { VerdictSource, VerdictStatus } from "./types.ts";

/** Sources of decisions made in Digga, as opposed to seeds imported from Discogs or a browser. */
export function isTriageSource(source: VerdictSource): boolean {
  return source === "triage" || source === "manual";
}

/**
 * When the record was last judged in Digga, after a verdict write: a decision made in Digga sets
 * it to its own date, and a seed keeps the one the record had, so a want that the wantlist import
 * turns into a seed still counts as dug. A write that names it (undo, restore) sets it.
 */
export function dugAtAfter(
  write: { source: VerdictSource; decidedAt: string; dugAt?: string | null },
  previous: { dugAt: string | null } | null,
): string | null {
  if (write.dugAt !== undefined) return write.dugAt;
  if (isTriageSource(write.source)) return write.decidedAt;
  return previous?.dugAt ?? null;
}

/**
 * Which verdict a seed import may replace: a seed never overwrites a higher rank. Facts about
 * the Discogs account outrank opinions: collection 3 > grail 2.5 > wantlist 2 > want from
 * triage 1.6 > the Discogs Maybe list 1.55 > other triage and manual decisions 1.5 > seen in
 * browser history 1. A grail is on the wantlist too, so the wantlist import confirms it instead
 * of turning it into a plain want; owning the record still ends the hunt.
 */
export function seedRank(verdict: { status: VerdictStatus; source: VerdictSource }): number {
  if (verdict.status === "collection") return 3;
  if (verdict.status === "candidate") return 2.5;
  if (verdict.status === "wantlist") return 2;
  if (verdict.status === "seen") return 1;
  if (verdict.source === "seed:list") return 1.55;
  if (verdict.status === "accepted") return 1.6;
  return 1.5;
}

/**
 * The verdict a record keeps when two meet on its key, as when a dump load puts two judged
 * pressings under one master: the higher rank, then the newer decision.
 */
export function preferredVerdict<
  V extends { status: VerdictStatus; source: VerdictSource; decidedAt: string },
>(left: V, right: V): V {
  const byRank = seedRank(left) - seedRank(right);
  if (byRank !== 0) return byRank > 0 ? left : right;
  return Date.parse(right.decidedAt) > Date.parse(left.decidedAt) ? right : left;
}
