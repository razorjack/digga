import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createSecrets, parseDotEnv, withDotEnvValue } from "../src/server/secrets.ts";

describe(".env values", () => {
  it("replaces a key in place and keeps the other lines and comments", () => {
    const text = "# Discogs\nexport DISCOGS_TOKEN=old\nOTHER='x'\n";
    expect(withDotEnvValue(text, "DISCOGS_TOKEN", "new")).toBe(
      "# Discogs\nDISCOGS_TOKEN=new\nOTHER='x'\n",
    );
  });

  it("appends a missing key and removes every line of a cleared one", () => {
    expect(withDotEnvValue("", "DISCOGS_TOKEN", "abc")).toBe("DISCOGS_TOKEN=abc\n");
    expect(withDotEnvValue("OTHER=1", "DISCOGS_TOKEN", "abc")).toBe("OTHER=1\nDISCOGS_TOKEN=abc\n");
    const twice = "DISCOGS_TOKEN=a\nOTHER=1\nDISCOGS_TOKEN=b\n";
    expect(withDotEnvValue(twice, "DISCOGS_TOKEN", null)).toBe("OTHER=1\n");
    expect(withDotEnvValue(twice, "DISCOGS_TOKEN", "c")).toBe("DISCOGS_TOKEN=c\nOTHER=1\n");
    expect(withDotEnvValue("DISCOGS_TOKEN=a\n", "DISCOGS_TOKEN", null)).toBe("");
  });

  it("reads what it writes", () => {
    const text = withDotEnvValue('# note\nOTHER="quoted"\n', "DISCOGS_TOKEN", "abc123");
    expect(parseDotEnv(text)).toEqual({ OTHER: "quoted", DISCOGS_TOKEN: "abc123" });
  });
});

describe("the Discogs token", () => {
  let tmp: string;
  let envFile: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-secrets-"));
    envFile = path.join(tmp, ".env");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("is saved to the .env file, readable by its owner only, and removed again", () => {
    fs.writeFileSync(envFile, "# keep me\nOTHER=1\n");
    const secrets = createSecrets({ envFile, env: {} });
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual([undefined, null]);

    secrets.setDiscogsToken("abc123");
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual(["abc123", "saved"]);
    expect(fs.readFileSync(envFile, "utf8")).toBe("# keep me\nOTHER=1\nDISCOGS_TOKEN=abc123\n");
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
    expect(createSecrets({ envFile, env: {} }).getDiscogsToken()).toBe("abc123");

    secrets.setDiscogsToken(null);
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual([undefined, null]);
    expect(fs.readFileSync(envFile, "utf8")).toBe("# keep me\nOTHER=1\n");
  });

  it("comes from the environment before the file", () => {
    fs.writeFileSync(envFile, "DISCOGS_TOKEN=from-file\n");
    const secrets = createSecrets({ envFile, env: { DISCOGS_TOKEN: " from-env " } });
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual([
      "from-env",
      "environment",
    ]);
    const blank = createSecrets({ envFile, env: { DISCOGS_TOKEN: "" } });
    expect([blank.getDiscogsToken(), blank.discogsTokenSource()]).toEqual(["from-file", "saved"]);
  });
});
