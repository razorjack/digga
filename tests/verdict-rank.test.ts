import { describe, expect, it } from "vite-plus/test";
import { isTriageSource, seedRank } from "../src/shared/verdict-rank.ts";

describe("seed precedence", () => {
  it("ranks account facts over opinions, want and grail over the Maybe list", () => {
    const collection = seedRank({ status: "collection", source: "seed:collection" });
    const wantlist = seedRank({ status: "wantlist", source: "seed:wantlist" });
    const want = seedRank({ status: "accepted", source: "triage" });
    const grail = seedRank({ status: "candidate", source: "triage" });
    const listMaybe = seedRank({ status: "maybe", source: "seed:list" });
    const triageMaybe = seedRank({ status: "maybe", source: "triage" });
    const skip = seedRank({ status: "rejected", source: "triage" });
    const snooze = seedRank({ status: "snoozed", source: "triage" });
    const seen = seedRank({ status: "seen", source: "seed:history" });
    expect(collection).toBeGreaterThan(wantlist);
    expect(wantlist).toBeGreaterThan(want);
    expect(want).toBe(grail);
    expect(want).toBeGreaterThan(listMaybe);
    expect(listMaybe).toBeGreaterThan(triageMaybe);
    expect([skip, snooze]).toEqual([triageMaybe, triageMaybe]);
    expect(triageMaybe).toBeGreaterThan(seen);
  });

  it("tells Digga's decisions from seeds", () => {
    expect(isTriageSource("triage")).toBe(true);
    expect(isTriageSource("manual")).toBe(true);
    expect(isTriageSource("seed:list")).toBe(false);
  });
});
