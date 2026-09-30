import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { parseDumpOptions, parseImportOptions, parseServeOptions } from "../src/cli/options.ts";
import { withDatabase } from "../src/cli/runtime.ts";
import type { Db } from "../src/server/db/db.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { FIXTURE_GZ, silentLogger, testSecrets } from "./helpers.ts";

describe("CLI workflows", () => {
  it("validates command options before execution", () => {
    expect(() => parseDumpOptions([FIXTURE_GZ, "--limit", "0"], DEFAULT_CONFIG)).toThrow("--limit");
    expect(parseDumpOptions([FIXTURE_GZ, "--dry-run"], DEFAULT_CONFIG).dryRun).toBe(true);
    expect(() =>
      parseImportOptions(["history", "--browser", "bad"], DEFAULT_CONFIG, "/tmp"),
    ).toThrow("--browser");
    expect(parseImportOptions(["list", "--list", "77"], DEFAULT_CONFIG, "/tmp")).toMatchObject({
      kind: "list",
      options: { listId: 77 },
    });
    expect(parseImportOptions(["seller", "Shop"], DEFAULT_CONFIG, "/tmp")).toEqual({
      kind: "seller",
      options: { username: "Shop" },
    });
    expect(() => parseImportOptions(["seller"], DEFAULT_CONFIG, "/tmp")).toThrow("username");
    expect(parseServeOptions(["--port", "0"])).toEqual({ port: 0, host: undefined });
  });

  it("closes its database when a job rejects", async () => {
    const runtime = {
      config: DEFAULT_CONFIG,
      paths: { ...resolvePaths({ dataDir: "/tmp" }), dbFile: ":memory:" },
      secrets: testSecrets(),
      logger: silentLogger,
    };
    let database: Db | undefined;
    await expect(
      withDatabase(runtime, (db) => {
        database = db;
        throw new Error("job failed");
      }),
    ).rejects.toThrow("job failed");
    expect(database?.open).toBe(false);
  });

  it("runs the Node entry point against an isolated data directory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digga-cli-"));
    const cli = fileURLToPath(new URL("../src/cli/digga.ts", import.meta.url));
    const env = {
      ...process.env,
      DIGGA_DATA_DIR: path.join(directory, "data"),
      DIGGA_CONFIG_FILE: path.join(directory, "config.json"),
    };
    try {
      const output = execFileSync(
        process.execPath,
        [cli, "dump", "load", FIXTURE_GZ, "--dry-run"],
        { cwd: directory, env, encoding: "utf8" },
      );
      expect(output).toContain("dry run, nothing written");
      const stats = execFileSync(process.execPath, [cli, "stats"], {
        cwd: directory,
        env,
        encoding: "utf8",
      });
      expect(stats).toContain("0 releases");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
