import { describe, expect, it } from "vite-plus/test";
import { dugAtAfter, isTriageSource, seedRank } from "../src/shared/verdict-rank.ts";

describe("seed precedence", () => {
  it("ranks account facts over opinions, and a grail between the collection and the wantlist", () => {
    const collection = seedRank({ status: "collection", source: "seed:collection" });
    const wantlist = seedRank({ status: "wantlist", source: "seed:wantlist" });
    const want = seedRank({ status: "accepted", source: "triage" });
    const grail = seedRank({ status: "candidate", source: "triage" });
    const listMaybe = seedRank({ status: "maybe", source: "seed:list" });
    const triageMaybe = seedRank({ status: "maybe", source: "triage" });
    const skip = seedRank({ status: "rejected", source: "triage" });
    const snooze = seedRank({ status: "snoozed", source: "triage" });
    const seen = seedRank({ status: "seen", source: "seed:history" });
    expect(collection).toBeGreaterThan(grail);
    expect(grail).toBeGreaterThan(wantlist);
    expect(wantlist).toBeGreaterThan(want);
    expect(want).toBeGreaterThan(listMaybe);
    expect(listMaybe).toBeGreaterThan(triageMaybe);
    expect([skip, snooze]).toEqual([triageMaybe, triageMaybe]);
    expect(triageMaybe).toBeGreaterThan(seen);
  });

  it("dates a record dug by the decisions made in Digga, through the seeds that replace them", () => {
    const decidedAt = "2026-10-03T10:00:00.000Z";
    const dug = { dugAt: "2026-10-02T09:00:00.000Z" };
    expect(dugAtAfter({ source: "triage", decidedAt }, dug)).toBe(decidedAt);
    expect(dugAtAfter({ source: "manual", decidedAt }, null)).toBe(decidedAt);
    expect(dugAtAfter({ source: "seed:wantlist", decidedAt }, dug)).toBe(dug.dugAt);
    expect(dugAtAfter({ source: "seed:list", decidedAt }, null)).toBeNull();
    expect(dugAtAfter({ source: "seed:wantlist", decidedAt, dugAt: null }, dug)).toBeNull();
  });

  it("tells Digga's decisions from seeds", () => {
    expect(isTriageSource("triage")).toBe(true);
    expect(isTriageSource("manual")).toBe(true);
    expect(isTriageSource("seed:list")).toBe(false);
  });
});
