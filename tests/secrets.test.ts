import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createSecrets,
  parseDotEnv,
  type SecretEncryption,
  withDotEnvValue,
} from "../src/server/secrets.ts";

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

/** Stands in for safeStorage: reversible, and never the token's own text. */
function fakeEncryption(available = true): SecretEncryption {
  return {
    isAvailable: () => available,
    encrypt: (text) => Buffer.from(`sealed:${text}`).toString("base64"),
    decrypt(stored) {
      const text = Buffer.from(stored, "base64").toString();
      if (!text.startsWith("sealed:")) throw new Error("Error while decrypting the ciphertext");
      return text.slice("sealed:".length);
    },
  };
}

describe("the Discogs token with encryption", () => {
  let tmp: string;
  let envFile: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-secrets-"));
    envFile = path.join(tmp, "secrets.env");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("is saved encrypted, read back by the next start, and removed again", () => {
    const encryption = fakeEncryption();
    const secrets = createSecrets({ envFile, env: {}, encryption });

    secrets.setDiscogsToken("e2e-token-dj");
    const text = fs.readFileSync(envFile, "utf8");
    expect(text).not.toContain("e2e-token-dj");
    expect(parseDotEnv(text)).toEqual({
      DISCOGS_TOKEN_ENCRYPTED: encryption.encrypt("e2e-token-dj"),
    });
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);

    const relaunched = createSecrets({ envFile, env: {}, encryption });
    expect(relaunched.getDiscogsToken()).toBe("e2e-token-dj");
    expect([relaunched.discogsTokenSource(), relaunched.discogsTokenEncrypted()]).toEqual([
      "saved",
      true,
    ]);

    relaunched.setDiscogsToken(null);
    expect(fs.readFileSync(envFile, "utf8")).toBe("");
    expect([relaunched.getDiscogsToken(), relaunched.discogsTokenEncrypted()]).toEqual([
      undefined,
      false,
    ]);
  });

  it("gives DISCOGS_TOKEN in the environment precedence over the saved token", () => {
    createSecrets({ envFile, env: {}, encryption: fakeEncryption() }).setDiscogsToken("saved");
    const secrets = createSecrets({
      envFile,
      env: { DISCOGS_TOKEN: "from-env" },
      encryption: fakeEncryption(),
    });
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual([
      "from-env",
      "environment",
    ]);
  });

  it("reads a token the browser version saved, and encrypts it when it is saved again", () => {
    fs.writeFileSync(envFile, "# saved by the browser version\nDISCOGS_TOKEN=plain-token\n");
    const secrets = createSecrets({ envFile, env: {}, encryption: fakeEncryption() });
    expect([secrets.getDiscogsToken(), secrets.discogsTokenEncrypted()]).toEqual([
      "plain-token",
      false,
    ]);

    secrets.setDiscogsToken("plain-token");
    const text = fs.readFileSync(envFile, "utf8");
    expect(text).toMatch(/^# saved by the browser version\nDISCOGS_TOKEN_ENCRYPTED=\S+\n$/);
    expect(secrets.discogsTokenEncrypted()).toBe(true);
  });

  it("saves the token as text where the system cannot encrypt it", () => {
    const secrets = createSecrets({ envFile, env: {}, encryption: fakeEncryption(false) });
    secrets.setDiscogsToken("e2e-token-dj");

    expect(fs.readFileSync(envFile, "utf8")).toBe("DISCOGS_TOKEN=e2e-token-dj\n");
    expect([secrets.getDiscogsToken(), secrets.discogsTokenEncrypted()]).toEqual([
      "e2e-token-dj",
      false,
    ]);
  });

  it("replaces the encrypted token when the browser version saves one", () => {
    createSecrets({ envFile, env: {}, encryption: fakeEncryption() }).setDiscogsToken("old");
    const browser = createSecrets({ envFile, env: {} });
    expect(browser.getDiscogsToken()).toBeUndefined();

    browser.setDiscogsToken("new");
    expect(fs.readFileSync(envFile, "utf8")).toBe("DISCOGS_TOKEN=new\n");
    const app = createSecrets({ envFile, env: {}, encryption: fakeEncryption() });
    expect([app.getDiscogsToken(), app.discogsTokenEncrypted()]).toEqual(["new", false]);
  });

  it("counts a token it cannot decrypt as none", () => {
    fs.writeFileSync(envFile, "DISCOGS_TOKEN_ENCRYPTED=bm90LXNlYWxlZA==\n");
    const secrets = createSecrets({ envFile, env: {}, encryption: fakeEncryption() });
    expect([secrets.getDiscogsToken(), secrets.discogsTokenSource()]).toEqual([undefined, null]);
  });
});
