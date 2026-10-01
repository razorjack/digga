import { formatCount } from "../../shared/display.ts";

/**
 * The headline at the end of the queue. Records passed with N have no verdict and come round
 * again, so while there are any, the headline does not say that every record has one.
 */
export function endOfQueueHeadline(passed: number): string {
  if (passed === 0) return "Every release under your filters has a verdict.";
  return `Every release under your filters has a verdict, apart from the ${formatCount(passed)} you passed.`;
}
