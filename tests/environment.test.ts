import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { launchEnvironment } from "../src/cli/environment.ts";
import { resolvePaths } from "../src/server/paths.ts";

describe("the launch environment", () => {
  it("names the library, the services and the log level, ignoring blank values", () => {
    const environment = launchEnvironment({
      DIGGA_DATA_DIR: " /tmp/library ",
      DIGGA_DUMPS_DIR: "/tmp/dumps",
      DIGGA_CONFIG_FILE: "",
      DIGGA_LOG_LEVEL: "debug",
      DIGGA_DUMPS_URL: "http://127.0.0.1:4567/dumps",
      DIGGA_DISCOGS_API_URL: "http://127.0.0.1:4567/discogs",
      DIGGA_YOUTUBE_OEMBED_URL: "http://127.0.0.1:4567/oembed",
    });

    expect(environment).toEqual({
      paths: { dataDir: "/tmp/library", dumpsDir: "/tmp/dumps", configFile: undefined },
      logLevel: "debug",
      services: {
        dataDumpsUrl: "http://127.0.0.1:4567/dumps",
        discogsApiUrl: "http://127.0.0.1:4567/discogs",
        youtubeOembedUrl: "http://127.0.0.1:4567/oembed",
      },
    });
  });

  it("opens the library it names, with its config, token and lock in it", () => {
    const { paths: pathOptions } = launchEnvironment({ DIGGA_DATA_DIR: "/tmp/library" });
    const paths = resolvePaths(pathOptions);

    expect(paths.dbFile).toBe(path.resolve("/tmp/library/digga.sqlite"));
    expect(paths.configFile).toBe(path.resolve("/tmp/library/digga.config.json"));
    expect(paths.secretsFile).toBe(path.resolve("/tmp/library/secrets.env"));
    expect(paths.lockFile).toBe(path.resolve("/tmp/library/digga.lock"));
    expect(paths.dumpsDir).toBe(path.resolve("/tmp/library/dumps"));
  });

  it("logs at info unless told otherwise, and refuses a level it does not know", () => {
    expect(launchEnvironment({}).logLevel).toBe("info");
    expect(() => launchEnvironment({ DIGGA_LOG_LEVEL: "verbose" })).toThrow(
      "DIGGA_LOG_LEVEL must be one of debug, info, warn, error",
    );
  });
});
