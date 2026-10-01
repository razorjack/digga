import { describe, expect, it } from "vite-plus/test";
import { endOfQueueHeadline } from "../src/client/triage/end-of-queue.ts";

describe("endOfQueueHeadline", () => {
  it("says every release has a verdict when nothing was passed", () => {
    expect(endOfQueueHeadline(0)).toBe("Every release under your filters has a verdict.");
  });

  it("leaves out the records passed with N, which have none", () => {
    expect(endOfQueueHeadline(1)).toBe(
      "Every release under your filters has a verdict, apart from the 1 you passed.",
    );
    expect(endOfQueueHeadline(1200)).toBe(
      "Every release under your filters has a verdict, apart from the 1,200 you passed.",
    );
  });
});
