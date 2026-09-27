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

describe("digga.config.example.json", () => {
  it("is valid and equals the schema defaults", () => {
    const parsed = ConfigSchema.parse(JSON.parse(fs.readFileSync(EXAMPLE, "utf8")));
    expect(parsed).toEqual(DEFAULT_CONFIG);
    expect(parsed.discogs.username).toBe("");
  });

  it("is copied on first run and then left alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-config-"));
    fs.copyFileSync(EXAMPLE, path.join(dir, "digga.config.example.json"));
    const paths = resolvePaths({ baseDir: dir });
    expect(paths.configExampleFile).toBe(path.join(dir, "digga.config.example.json"));
    const first = loadConfig(paths.configFile, paths.configExampleFile);
    expect(first).toEqual(DEFAULT_CONFIG);
    expect(fs.existsSync(paths.configFile)).toBe(true);
    const edited = { ...first, discogs: { ...first.discogs, username: "someone" } };
    fs.writeFileSync(paths.configFile, JSON.stringify(edited));
    expect(loadConfig(paths.configFile, paths.configExampleFile).discogs.username).toBe("someone");
    const bare = loadConfig(path.join(dir, "elsewhere", "digga.config.json"));
    expect(bare).toEqual(DEFAULT_CONFIG);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
