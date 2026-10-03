import type { VerdictSource, VerdictStatus } from "./types.ts";

/** Decisions made in Digga, as opposed to hits imported from the browser history. */
export function isTriageSource(source: VerdictSource): boolean {
  return source === "triage" || source === "manual";
}

/**
 * Which verdict outranks another when two meet on one record: a grail, then a want, then any
 * other decision made in Digga, then a page seen in the browser history, which never replaces a
 * decision.
 */
export function verdictRank(verdict: { status: VerdictStatus }): number {
  if (verdict.status === "candidate") return 3;
  if (verdict.status === "accepted") return 2;
  if (verdict.status === "seen") return 0;
  return 1;
}

/**
 * The verdict a record keeps when two meet on its key, as when a dump load puts two judged
 * pressings under one master: the higher rank, then the newer decision, so a want is never lost
 * to a skip.
 */
export function preferredVerdict<V extends { status: VerdictStatus; decidedAt: string }>(
  left: V,
  right: V,
): V {
  const byRank = verdictRank(left) - verdictRank(right);
  if (byRank !== 0) return byRank > 0 ? left : right;
  return Date.parse(right.decidedAt) > Date.parse(left.decidedAt) ? right : left;
}
