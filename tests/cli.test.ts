import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  parseDumpOptions,
  parseImportOptions,
  parseRestoreOptions,
  parseServeOptions,
} from "../src/cli/options.ts";
import { withDatabase } from "../src/cli/runtime.ts";
import { writeBackup } from "../src/server/db/backup.ts";
import { type Db, openDb } from "../src/server/db/db.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { lockLibrary } from "../src/server/library-lock.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { FIXTURE_GZ, silentLogger, testSecrets } from "./helpers.ts";

describe("CLI workflows", () => {
  it("validates command options before execution", () => {
    expect(() => parseDumpOptions([FIXTURE_GZ, "--limit", "0"], DEFAULT_CONFIG)).toThrow("--limit");
    expect(parseDumpOptions([FIXTURE_GZ, "--dry-run"], DEFAULT_CONFIG).dryRun).toBe(true);
    expect(() => parseImportOptions(["history"], DEFAULT_CONFIG)).toThrow(
      "import needs one of: collection, wantlist, list, seller",
    );
    expect(parseImportOptions(["list", "--list", "77"], DEFAULT_CONFIG)).toMatchObject({
      kind: "list",
      options: { listId: 77 },
    });
    expect(parseImportOptions(["seller", "Shop"], DEFAULT_CONFIG)).toEqual({
      kind: "seller",
      options: { username: "Shop" },
    });
    expect(() => parseImportOptions(["seller"], DEFAULT_CONFIG)).toThrow("username");
    expect(parseServeOptions(["--port", "0"])).toEqual({ port: 0, host: undefined });
  });

  it("finds a backup to restore by path, or by name in the backups folder", () => {
    const name = "decisions-2026-09-10.json.gz";
    const file = (args: string[]) => parseRestoreOptions(args, "/library/backups").file;
    expect(file([name])).toBe(path.join("/library/backups", name));
    expect(file([`./${name}`])).toBe(`./${name}`);
    expect(file([FIXTURE_GZ])).toBe(FIXTURE_GZ);
    expect(() => file([])).toThrow("usage: digga restore");
  });

  it("restores settings only with --config", () => {
    const name = "decisions-2026-09-10.json.gz";
    const file = path.join("/b", name);
    expect(parseRestoreOptions([name], "/b")).toEqual({
      kind: "decisions",
      file,
      restoreConfig: false,
    });
    expect(parseRestoreOptions([name, "--config"], "/b")).toMatchObject({ restoreConfig: true });
    expect(parseRestoreOptions(["--config", name], "/b")).toMatchObject({ restoreConfig: true });
  });

  it("restores a .sqlite file as a database copy, which has no settings", () => {
    const name = "digga-2026-10-01.sqlite";
    expect(parseRestoreOptions([name], "/b")).toEqual({
      kind: "database",
      file: path.join("/b", name),
    });
    expect(() => parseRestoreOptions([name, "--config"], "/b")).toThrow("a database copy has none");
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

  it("restores a database copy through the Node entry point, unless the library is in use", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digga-restore-"));
    const cli = fileURLToPath(new URL("../src/cli/digga.ts", import.meta.url));
    const paths = resolvePaths({ dataDir: path.join(directory, "data") });
    const env = {
      ...process.env,
      DIGGA_DATA_DIR: paths.dataDir,
      DIGGA_CONFIG_FILE: path.join(directory, "config.json"),
    };
    const restore = () =>
      spawnSync(process.execPath, [cli, "restore", "digga-2026-10-01.sqlite"], {
        cwd: directory,
        env,
        encoding: "utf8",
      });
    try {
      const db = openDb(paths.dbFile);
      upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });
      await writeBackup(db, { dir: paths.backupsDir, day: "2026-10-01" });
      upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage" });
      db.close();

      const lock = lockLibrary(paths.lockFile, "the Digga server");
      const refused = restore();
      lock.release();
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("in use by the Digga server");
      expect(statusIn(paths.dbFile, "m:501")).toBe("rejected");

      const restored = restore();
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toMatch(
        /^copied the database first: \S+before-restore-\S+\.sqlite$/m,
      );
      expect(restored.stdout).toContain(
        `restored ${path.join(paths.backupsDir, "digga-2026-10-01.sqlite")}, schema version`,
      );
      expect(statusIn(paths.dbFile, "m:501")).toBe("accepted");
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

function statusIn(file: string, key: string): string | undefined {
  const db = openDb(file, { readonly: true });
  try {
    return getVerdict(db, key)?.status;
  } finally {
    db.close();
  }
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}
