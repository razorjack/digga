import { describe, expect, it } from "vite-plus/test";
import { parseTriageKey, triageKeyFor } from "../src/shared/triage-key.ts";

describe("triageKeyFor", () => {
  it("prefers the master id and falls back to the release id", () => {
    expect(triageKeyFor({ id: 10, masterId: 5 })).toBe("m:5");
    expect(triageKeyFor({ id: 10, masterId: null })).toBe("r:10");
    expect(triageKeyFor({ id: 10, masterId: 0 })).toBe("r:10");
  });
  it("round-trips through parseTriageKey", () => {
    expect(parseTriageKey("m:5")).toEqual({ kind: "master", id: 5 });
    expect(parseTriageKey("r:10")).toEqual({ kind: "release", id: 10 });
    expect(parseTriageKey("x:1")).toBeNull();
  });
});
