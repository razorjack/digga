import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { appFolders, resolvePaths, saveChosenDumpsDir, type System } from "../src/server/paths.ts";

describe("app folders", () => {
  it("are the ones Electron uses for userData, with a cache folder beside them", () => {
    expect(appFolders({ platform: "darwin", env: {}, home: "/Users/dj" })).toEqual({
      data: "/Users/dj/Library/Application Support/Digga",
      cache: "/Users/dj/Library/Caches/Digga",
    });
    expect(
      appFolders({
        platform: "win32",
        env: { APPDATA: "D:\\Roaming", LOCALAPPDATA: "D:\\Local" },
        home: "C:\\Users\\dj",
      }),
    ).toEqual({ data: "D:\\Roaming\\Digga", cache: "D:\\Local\\Digga\\Cache" });
    expect(appFolders({ platform: "win32", env: {}, home: "C:\\Users\\dj" })).toEqual({
      data: "C:\\Users\\dj\\AppData\\Roaming\\Digga",
      cache: "C:\\Users\\dj\\AppData\\Local\\Digga\\Cache",
    });
    expect(
      appFolders({
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/xdg/config", XDG_CACHE_HOME: "" },
        home: "/home/dj",
      }),
    ).toEqual({ data: "/xdg/config/Digga", cache: "/home/dj/.cache/Digga" });
  });
});

describe("resolving paths", () => {
  let home: string;
  /** This platform with a home of the test's own, so no test reads the real app folder. */
  let system: System;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "digga-paths-"));
    system = { platform: process.platform, env: {}, home };
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps the library in the app folder and the dumps in the cache folder by default", () => {
    const folders = appFolders(system);
    const paths = resolvePaths({}, system);
    expect(paths.dataDir).toBe(folders.data);
    expect(paths.dbFile).toBe(path.join(folders.data, "digga.sqlite"));
    expect(paths.configFile).toBe(path.join(folders.data, "digga.config.json"));
    expect(paths.secretsFile).toBe(path.join(folders.data, "secrets.env"));
    expect(paths.dumpsDir).toBe(path.join(folders.cache, "dumps"));
    expect(paths.dumpsDirSource).toBe("default");
  });

  it("takes the dumps folder chosen in the app over the default, and DIGGA_DUMPS_DIR over both", () => {
    const chosen = path.join(home, "Volumes", "Crates");
    const saved = saveChosenDumpsDir(resolvePaths({}, system), chosen);
    expect(saved).toMatchObject({ dumpsDir: chosen, dumpsDirSource: "chosen" });

    expect(resolvePaths({}, system)).toMatchObject({ dumpsDir: chosen, dumpsDirSource: "chosen" });
    expect(resolvePaths({ dumpsDir: "/big/disk" }, system)).toMatchObject({
      dumpsDir: "/big/disk",
      dumpsDirSource: "environment",
    });
    expect(fs.readFileSync(saved.dumpsFolderFile, "utf8")).toBe(
      `${JSON.stringify({ dumpsDir: chosen }, null, 2)}\n`,
    );
  });

  it("keeps the dumps of a library given by hand with it until one is chosen there", () => {
    const dataDir = path.join(home, "library");
    expect(resolvePaths({ dataDir }, system).dumpsDir).toBe(path.join(dataDir, "dumps"));

    saveChosenDumpsDir(resolvePaths({ dataDir }, system), "/big/disk");
    expect(resolvePaths({ dataDir }, system).dumpsDir).toBe("/big/disk");
    expect(resolvePaths({}, system).dumpsDirSource).toBe("default");
  });

  it("takes no choice from a file it cannot read, or one naming no absolute folder", () => {
    const { dumpsFolderFile } = resolvePaths({}, system);
    fs.mkdirSync(path.dirname(dumpsFolderFile), { recursive: true });

    for (const written of ["{", '{"dumpsDir": "relative/dumps"}', '{"dumpsDir": 7}', "[]"]) {
      fs.writeFileSync(dumpsFolderFile, written);
      expect(resolvePaths({}, system).dumpsDirSource).toBe("default");
    }
  });

  it("keeps everything, dumps included, in a library folder given by hand", () => {
    const paths = resolvePaths({ dataDir: "/tmp/throwaway" }, system);
    expect(paths.dbFile).toBe("/tmp/throwaway/digga.sqlite");
    expect(paths.dumpsDir).toBe("/tmp/throwaway/dumps");
    expect(paths.backupsDir).toBe("/tmp/throwaway/backups");
    expect(
      resolvePaths({ dataDir: "/tmp/throwaway", dumpsDir: "/big/disk" }, system).dumpsDir,
    ).toBe("/big/disk");
  });
});
