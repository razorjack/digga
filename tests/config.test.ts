import { describe, expect, it } from "vite-plus/test";
import { ConfigSchema, DEFAULT_CONFIG, validateConfig } from "../src/shared/config.ts";

describe("config schema", () => {
  it("fills every default from an empty object", () => {
    expect(DEFAULT_CONFIG.server.port).toBe(3456);
    expect(DEFAULT_CONFIG.universe.styles).toEqual(["Drum n Bass"]);
    expect(DEFAULT_CONFIG.filters).toEqual({
      styles: null,
      yearFrom: 1998,
      yearTo: 2002,
      includeUnknownYear: false,
      formats: ["Vinyl"],
      countries: [],
    });
    expect(DEFAULT_CONFIG.queue.strategy).toBe("label_sweep");
  });

  it("accepts nullable year bounds and null loadYears", () => {
    const c = ConfigSchema.parse({
      filters: { yearFrom: null, yearTo: null },
      universe: { loadYears: null },
    });
    expect(c.filters.yearFrom).toBeNull();
    expect(c.filters.yearTo).toBeNull();
    expect(c.universe.loadYears).toBeNull();
  });

  it("reports invalid values with paths", () => {
    const r = validateConfig({ queue: { strategy: "nope" }, server: { port: 70000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("queue.strategy"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("server.port"))).toBe(true);
    }
  });
});
