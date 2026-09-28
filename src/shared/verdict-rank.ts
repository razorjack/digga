import type { VerdictSource, VerdictStatus } from "./types.ts";

/** Sources of decisions made in Digga, as opposed to seeds imported from Discogs or a browser. */
export function isTriageSource(source: VerdictSource): boolean {
  return source === "triage" || source === "manual";
}

/**
 * Which verdict a seed import may replace: a seed never overwrites a higher rank. Facts about
 * the Discogs account outrank opinions: collection 3 > wantlist 2 > want or grail from triage
 * 1.6 > the Discogs Maybe list 1.55 > other triage and manual decisions 1.5 > seen in browser
 * history 1.
 */
export function seedRank(verdict: { status: VerdictStatus; source: VerdictSource }): number {
  if (verdict.status === "collection") return 3;
  if (verdict.status === "wantlist") return 2;
  if (verdict.status === "seen") return 1;
  if (verdict.source === "seed:list") return 1.55;
  if (verdict.status === "accepted" || verdict.status === "candidate") return 1.6;
  return 1.5;
}
