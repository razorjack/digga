import type { Stats } from "../../shared/api.ts";
import type { Verdict } from "../../shared/types.ts";
import { isTriageSource } from "../../shared/verdict-rank.ts";
import type { TriageStatus } from "../keymap.ts";

/**
 * The counts after a verdict (delta 1) or its undo (delta -1), shown until the server's next
 * count. A record dug before only changes status; one the queue held also leaves the remaining
 * count. The server's count replaces these at the next refresh.
 */
export function countVerdict(
  stats: Stats,
  verdict: { status: TriageStatus; previous: Verdict | null },
  delta: 1 | -1,
): Stats {
  const { status, previous } = verdict;
  const verdicts = { ...stats.verdicts, [status]: stats.verdicts[status] + delta };
  if (previous) verdicts[previous.status] -= delta;
  const dugDelta = previous && isTriageSource(previous.source) ? 0 : delta;
  const wasQueued = previous === null || previous.status === "seen";
  const remainingDelta = wasQueued ? delta : 0;
  const { scopeRemaining } = stats;
  return {
    ...stats,
    dug: Math.max(0, stats.dug + dugDelta),
    remaining: Math.max(0, stats.remaining - remainingDelta),
    scopeRemaining: scopeRemaining === null ? null : Math.max(0, scopeRemaining - remainingDelta),
    verdicts,
  };
}
