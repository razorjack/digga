import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  parseDumpOptions,
  parseImportOptions,
  parseRestoreFile,
  parseServeOptions,
} from "../src/cli/options.ts";
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

  it("finds a backup to restore by path, or by name in the backups folder", () => {
    const name = "decisions-2026-09-10.json.gz";
    expect(parseRestoreFile([name], "/library/backups")).toBe(path.join("/library/backups", name));
    expect(parseRestoreFile([`./${name}`], "/library/backups")).toBe(`./${name}`);
    expect(parseRestoreFile([FIXTURE_GZ], "/library/backups")).toBe(FIXTURE_GZ);
    expect(() => parseRestoreFile([], "/library/backups")).toThrow("usage: digga restore");
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

  it("serves until its IPC parent asks it to stop or goes away", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digga-serve-"));
    const servers: ChildProcess[] = [];
    try {
      const asked = startServe(directory);
      servers.push(asked);
      const lines = await readServeLines(asked);
      expect(lines.serving).toMatch(/^digga serving on http:\/\/localhost:\d+$/);
      expect(lines.library).toBe(`library: ${path.join(directory, "data")}`);
      asked.send("shutdown");
      expect(await exitCode(asked)).toBe(0);

      const orphaned = startServe(directory);
      servers.push(orphaned);
      await readServeLines(orphaned);
      orphaned.disconnect();
      expect(await exitCode(orphaned)).toBe(0);
    } finally {
      for (const server of servers) server.kill("SIGKILL");
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

function startServe(directory: string): ChildProcess {
  const cli = fileURLToPath(new URL("../src/cli/digga.ts", import.meta.url));
  return spawn(process.execPath, [cli, "serve", "--port", "0"], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      DIGGA_DATA_DIR: path.join(directory, "data"),
      DIGGA_CONFIG_FILE: path.join(directory, "config.json"),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

/** The two lines the end-to-end harness reads from `digga serve`; log lines come between. */
async function readServeLines(child: ChildProcess): Promise<{ serving: string; library: string }> {
  let output = "";
  for await (const chunk of child.stdout!) {
    output += String(chunk);
    const lines = output.split("\n");
    const serving = lines.find((line) => line.startsWith("digga serving on "));
    const library = lines.find((line) => line.startsWith("library: "));
    if (serving && library) return { serving, library };
  }
  throw new Error(`digga serve ended before it was serving: ${output}`);
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}
