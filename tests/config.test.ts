import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "../src/server/config-file.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { ConfigSchema, DEFAULT_CONFIG, validateConfig } from "../src/shared/config.ts";

const EXAMPLE = fileURLToPath(new URL("../digga.config.example.json", import.meta.url));

describe("config schema", () => {
  it("fills every default from an empty object", () => {
    expect(DEFAULT_CONFIG.server.port).toBe(3456);
    expect(DEFAULT_CONFIG.universe.styles).toEqual(["Drum n Bass"]);
    expect(DEFAULT_CONFIG.filters).toEqual({
      styles: null,
      yearFrom: 1998,
      yearTo: 2002,
      includeUnknownYear: false,
      includeUnknownYearOnCoverage: true,
      formats: ["Vinyl"],
      countries: [],
      skipHistory: true,
      skipWithoutVideos: false,
      excludeLabels: [],
      includeDescriptions: [],
      excludeDescriptions: [],
    });
    expect(DEFAULT_CONFIG.queue.strategy).toBe("label_sweep");
    expect(DEFAULT_CONFIG.appearance.colorScheme).toBe("system");
  });

  it("digs a saved most-wanted order, which no longer exists, as a label sweep", () => {
    expect(ConfigSchema.parse({ queue: { strategy: "popular" } }).queue.strategy).toBe(
      "label_sweep",
    );
    expect(ConfigSchema.safeParse({ queue: { strategy: "loudest" } }).success).toBe(false);
  });

  it("reads hidden labels saved as plain names, which have no id", () => {
    const config = ConfigSchema.parse({
      filters: { excludeLabels: ["Virgin", { id: 1818, name: "Not On Label" }] },
    });
    expect(config.filters.excludeLabels).toEqual([
      { id: null, name: "Virgin" },
      { id: 1818, name: "Not On Label" },
    ]);
    expect(validateConfig({ filters: { excludeLabels: [""] } }).ok).toBe(false);
    expect(validateConfig({ filters: { excludeLabels: [{ id: 1.5, name: "Virgin" }] } }).ok).toBe(
      false,
    );
  });

  it("reads a config saved with enrich ahead, which no longer exists, and drops it", () => {
    const config = ConfigSchema.parse({ discogs: { username: "dj", enrichAhead: 5 } });
    expect(config.discogs).toEqual({ username: "dj", currency: "EUR", maybeListId: null });
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

  it("refuses a year range whose ends are inverted, at the field that ends it", () => {
    const r = validateConfig({
      filters: { yearFrom: 2002, yearTo: 1998 },
      universe: { loadYears: [2008, 1994] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toEqual([
        { path: "universe.loadYears", message: "The Load to year comes before the Load from year" },
        { path: "filters.yearTo", message: "The To year comes before the From year" },
      ]);
    }
  });

  it("accepts a single year and a range open at one end", () => {
    expect(validateConfig({ filters: { yearFrom: 2000, yearTo: 2000 } }).ok).toBe(true);
    expect(validateConfig({ filters: { yearFrom: 2003, yearTo: null } }).ok).toBe(true);
    expect(validateConfig({ universe: { loadYears: [2000, 2000] } }).ok).toBe(true);
  });

  it("listens on this computer only", () => {
    expect(ConfigSchema.parse({ server: { host: "::1" } }).server.host).toBe("::1");
    expect(validateConfig({ server: { host: "0.0.0.0" } }).ok).toBe(false);
  });

  it("reports invalid values with paths", () => {
    const r = validateConfig({
      queue: { strategy: "nope" },
      server: { port: 70000 },
      appearance: { colorScheme: "sepia" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("queue.strategy"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("server.port"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("appearance.colorScheme"))).toBe(true);
    }
  });

  it("reports each invalid value as an issue at its path", () => {
    const r = validateConfig({ queue: { limit: 0 }, player: { seekStepSeconds: null } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((issue) => issue.path)).toEqual([
        "queue.limit",
        "player.seekStepSeconds",
      ]);
      expect(r.issues.every((issue) => issue.message !== "")).toBe(true);
    }
  });
});

describe("digga.config.example.json", () => {
  it("is valid and equals the schema defaults", () => {
    const parsed = ConfigSchema.parse(JSON.parse(fs.readFileSync(EXAMPLE, "utf8")));
    expect(parsed).toEqual(DEFAULT_CONFIG);
    expect(parsed.discogs.username).toBe("");
  });

  it("shows the config a first run creates, which is then left alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-config-"));
    const paths = resolvePaths({ dataDir: dir });
    expect(paths.configFile).toBe(path.join(dir, "digga.config.json"));
    const first = loadConfig(paths.configFile);
    expect(first).toEqual(DEFAULT_CONFIG);
    expect(fs.existsSync(paths.configFile)).toBe(true);
    const edited = { ...first, discogs: { ...first.discogs, username: "someone" } };
    fs.writeFileSync(paths.configFile, JSON.stringify(edited));
    expect(loadConfig(paths.configFile).discogs.username).toBe("someone");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
