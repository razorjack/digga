import { describe, expect, it } from "vite-plus/test";
import { dugCount } from "../src/shared/api.ts";
import {
  formatCount,
  formatDay,
  formatDuration,
  formatEta,
  formatPrice,
  stampTilt,
} from "../src/shared/display.ts";

describe("display formatting", () => {
  it("formats counts, durations and prices", () => {
    expect(formatCount(4312)).toBe("4,312");
    expect(formatDuration(372)).toBe("6:12");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBe("");
    expect(formatPrice(12.5, "EUR")).toBe("€12.50");
    expect(formatPrice(12.5, "GBP")).toBe("£12.50");
    expect(formatPrice(12.5, null)).toBe("12.50");
  });

  it("formats ETAs and days", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(0.4)).toBe("~24 min");
    expect(formatEta(31.4)).toBe("~31 h");
    expect(formatEta(150)).toBe("~6 days");
    const now = new Date("2026-09-27T12:00:00Z");
    expect(formatDay("2026-09-27T10:00:00Z", now)).toBe("27 Sep");
    expect(formatDay("2025-01-03T10:00:00Z", now)).toBe("3 Jan 2025");
    expect(formatDay("garbage", now)).toBe("");
  });

  it("tilts stamps the same way for the same id, never straight", () => {
    const tilts = Array.from({ length: 500 }, (_, i) => stampTilt(i + 1));
    expect(stampTilt(42)).toBe(stampTilt(42));
    expect(Math.min(...tilts)).toBeGreaterThanOrEqual(-4.8);
    expect(Math.max(...tilts)).toBeLessThanOrEqual(3.8);
    expect(tilts.every((t) => Math.abs(t) >= 0.6)).toBe(true);
    expect(new Set(tilts).size).toBeGreaterThan(50);
  });
});

describe("dug count", () => {
  it("counts triage verdicts and ignores seeds", () => {
    const verdicts = {
      collection: 8,
      wantlist: 204,
      seen: 30,
      rejected: 5,
      accepted: 2,
      maybe: 1,
      candidate: 1,
      no_audio: 3,
    };
    expect(dugCount({ verdicts })).toBe(12);
  });
});
