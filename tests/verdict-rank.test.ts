import { describe, expect, it } from "vite-plus/test";
import type { VerdictStatus } from "../src/shared/types.ts";
import { isTriageSource, preferredVerdict, verdictRank } from "../src/shared/verdict-rank.ts";

describe("verdict precedence", () => {
  it("ranks a grail over a want over any other decision, and a history hit below them all", () => {
    const grail = verdictRank({ status: "candidate" });
    const want = verdictRank({ status: "accepted" });
    const maybe = verdictRank({ status: "maybe" });
    const skip = verdictRank({ status: "rejected" });
    const snooze = verdictRank({ status: "snoozed" });
    const seen = verdictRank({ status: "seen" });
    expect(grail).toBeGreaterThan(want);
    expect(want).toBeGreaterThan(maybe);
    expect([skip, snooze]).toEqual([maybe, maybe]);
    expect(maybe).toBeGreaterThan(seen);
  });

  it("keeps the higher rank, then the newer decision, when two verdicts meet on a record", () => {
    const judged = (status: VerdictStatus, decidedAt: string) => ({ status, decidedAt });
    const want = judged("accepted", "2026-10-01T10:00:00Z");
    const skip = judged("rejected", "2026-10-02T10:00:00Z");
    const snooze = judged("snoozed", "2026-10-03T12:00:00+02:00");
    expect(preferredVerdict(skip, want)).toBe(want);
    expect(preferredVerdict(want, skip)).toBe(want);
    expect(preferredVerdict(skip, snooze)).toBe(snooze);
    expect(preferredVerdict(snooze, skip)).toBe(snooze);
  });

  it("tells Digga's decisions from browser-history hits", () => {
    expect(isTriageSource("triage")).toBe(true);
    expect(isTriageSource("manual")).toBe(true);
    expect(isTriageSource("seed:history")).toBe(false);
  });
});
