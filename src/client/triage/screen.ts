import type { QueueItem, Stats } from "../../shared/api.ts";
import type { QueueScope } from "../../shared/scope.ts";

/** What the Triage page shows where the record goes. */
export type TriageScreen =
  | { kind: "settings-failed" }
  | { kind: "queue-failed" }
  | { kind: "waiting-for-load"; percent: number | null }
  | { kind: "no-releases" }
  | { kind: "nothing-matches"; loadedRecords: number }
  | { kind: "scope-dug"; scope: QueueScope }
  /** `dug` counts the records judged so far; null while the stats are unknown. */
  | { kind: "all-dug"; dug: number | null }
  | { kind: "record"; item: QueueItem }
  | { kind: "loading" };

export interface TriageScreenInput {
  settingsFailed: boolean;
  queueFailed: boolean;
  /** The queue has no record left to show. */
  finished: boolean;
  /** The record to judge; null while none is shown. */
  current: QueueItem | null;
  scope: QueueScope | null;
  stats: Stats | null;
  /** A dump load is adding records; null when none runs. */
  load: { fraction: number | null } | null;
}

export function triageScreen(input: TriageScreenInput): TriageScreen {
  if (input.settingsFailed) return { kind: "settings-failed" };
  if (input.queueFailed) return { kind: "queue-failed" };
  if (input.finished) return endOfQueueScreen(input);
  if (input.current) return { kind: "record", item: input.current };
  return { kind: "loading" };
}

function endOfQueueScreen({ load, stats, scope }: TriageScreenInput): TriageScreen {
  if (load) {
    const percent = load.fraction === null ? null : Math.floor(load.fraction * 100);
    return { kind: "waiting-for-load", percent };
  }
  if (stats?.universe.releases === 0) return { kind: "no-releases" };
  if (stats && stats.universe.filteredKeys === 0)
    return { kind: "nothing-matches", loadedRecords: stats.universe.keys };
  if (scope) return { kind: "scope-dug", scope };
  return { kind: "all-dug", dug: stats?.dug ?? null };
}
