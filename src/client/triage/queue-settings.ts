import { type Config, type HiddenLabel, isSameLabel } from "../../shared/config.ts";

/** What a saved config changes about the Triage queue. */
export type QueueSettingsChange =
  | { kind: "none" }
  /** The universe, the filters or the order changed: the queue starts again. */
  | { kind: "restart" }
  /** Only the hidden labels changed: their records leave the queue, or come back to it. */
  | { kind: "labels"; hidden: HiddenLabel[]; shown: HiddenLabel[] };

/**
 * Compares the parts of two configs that feed the queue. The player, the Discogs account, the
 * currency and the appearance do not, so saving them keeps the session as it is.
 */
export function queueSettingsChange(before: Config, after: Config): QueueSettingsChange {
  if (JSON.stringify(queueInputs(before)) !== JSON.stringify(queueInputs(after)))
    return { kind: "restart" };
  const hidden = labelsMissingFrom(before.filters.excludeLabels, after.filters.excludeLabels);
  const shown = labelsMissingFrom(after.filters.excludeLabels, before.filters.excludeLabels);
  if (hidden.length === 0 && shown.length === 0) return { kind: "none" };
  return { kind: "labels", hidden, shown };
}

function queueInputs(config: Config) {
  const { excludeLabels: _labels, ...filters } = config.filters;
  return { universe: config.universe, queue: config.queue, filters };
}

/** The labels of `labels` that `others` does not have. */
function labelsMissingFrom(others: HiddenLabel[], labels: HiddenLabel[]): HiddenLabel[] {
  return labels.filter((label) => !others.some((other) => isSameLabel(other, label)));
}
