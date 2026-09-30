import { describe, expect, it } from "vite-plus/test";
import {
  formatAge,
  formatBytes,
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

  it("formats sizes in binary units", () => {
    expect(formatBytes(950)).toBe("950 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(129_000_000)).toBe("123 MB");
    expect(formatBytes(11_252_161_836)).toBe("10.5 GB");
    expect(formatBytes(12 * 1024 ** 3)).toBe("12 GB");
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

  it("says how long ago something happened", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(formatAge("2026-09-27T11:59:30Z", now)).toBe("just now");
    expect(formatAge("2026-09-27T12:00:05Z", now)).toBe("just now");
    expect(formatAge("2026-09-27T11:55:00Z", now)).toBe("5 minutes ago");
    expect(formatAge("2026-09-27T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatAge("2026-09-26T10:00:00Z", now)).toBe("yesterday");
    expect(formatAge("2026-09-24T12:00:00Z", now)).toBe("3 days ago");
    expect(formatAge("2026-07-20T12:00:00Z", now)).toBe("2 months ago");
    expect(formatAge("2024-09-01T12:00:00Z", now)).toBe("2 years ago");
    expect(formatAge("garbage", now)).toBe("");
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
