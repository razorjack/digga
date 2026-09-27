import { describe, expect, it } from "vite-plus/test";
import { rateSummary, sessionsFromTimes, verdictsPerHour } from "../src/shared/rate.ts";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1) + minutes * 60_000).toISOString();

describe("rate and ETA", () => {
  it("splits sessions at gaps longer than 30 minutes", () => {
    const sessions = sessionsFromTimes([at(0), at(10), at(20), at(120), at(121), "not a date"]);
    expect(sessions.map((s) => s.count)).toEqual([3, 2]);
  });

  it("needs two decisions and counts short sessions as one minute", () => {
    expect(verdictsPerHour(sessionsFromTimes([at(0)])).rate).toBeNull();
    expect(verdictsPerHour(sessionsFromTimes([at(0), at(0)])).rate).toBe(120);
  });

  it("uses only the last five sessions", () => {
    const times = Array.from({ length: 6 }, (_, i) => [at(i * 100), at(i * 100 + 30)]).flat();
    expect(verdictsPerHour(sessionsFromTimes(times))).toEqual({ rate: 4, sessions: 5 });
  });

  it("summarises rate and ETA rounded to one decimal", () => {
    expect(rateSummary([at(0), at(20), at(40), at(60)], 100)).toEqual({
      verdictsPerHour: 4,
      sessions: 1,
      etaHours: 25,
    });
    expect(rateSummary([], 100)).toEqual({ verdictsPerHour: null, sessions: 0, etaHours: null });
  });
});
