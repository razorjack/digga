import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { appFolders, resolvePaths } from "../src/server/paths.ts";

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
  it("keeps the library in the app folder and the dumps in the cache folder by default", () => {
    const folders = appFolders({
      platform: process.platform,
      env: process.env,
      home: os.homedir(),
    });
    const paths = resolvePaths();
    expect(paths.dataDir).toBe(folders.data);
    expect(paths.dbFile).toBe(path.join(folders.data, "digga.sqlite"));
    expect(paths.configFile).toBe(path.join(folders.data, "digga.config.json"));
    expect(paths.secretsFile).toBe(path.join(folders.data, "secrets.env"));
    expect(paths.dumpsDir).toBe(path.join(folders.cache, "dumps"));
  });

  it("keeps everything, dumps included, in a library folder given by hand", () => {
    const paths = resolvePaths({ dataDir: "/tmp/throwaway" });
    expect(paths.dbFile).toBe("/tmp/throwaway/digga.sqlite");
    expect(paths.dumpsDir).toBe("/tmp/throwaway/dumps");
    expect(paths.backupsDir).toBe("/tmp/throwaway/backups");
    expect(resolvePaths({ dataDir: "/tmp/throwaway", dumpsDir: "/big/disk" }).dumpsDir).toBe(
      "/big/disk",
    );
  });
});
