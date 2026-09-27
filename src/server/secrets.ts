import fs from "node:fs";

export interface Secrets {
  getDiscogsToken(): string | undefined;
}

/** Minimal .env parser: KEY=value lines, optional quotes, # comments. Does not mutate process.env. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Secrets come from the environment first, then from the .env file.
 * Electron will replace this factory with one backed by safeStorage.
 */
export function createSecrets(opts: { envFile?: string }): Secrets {
  let fileValues: Record<string, string> | undefined;
  const fromFile = (key: string): string | undefined => {
    if (fileValues === undefined) {
      fileValues = {};
      if (opts.envFile && fs.existsSync(opts.envFile)) {
        fileValues = parseDotEnv(fs.readFileSync(opts.envFile, "utf8"));
      }
    }
    return fileValues[key];
  };
  return {
    getDiscogsToken() {
      const fromEnv = process.env.DISCOGS_TOKEN;
      const token = fromEnv && fromEnv.trim() !== "" ? fromEnv.trim() : fromFile("DISCOGS_TOKEN");
      return token && token.trim() !== "" ? token.trim() : undefined;
    },
  };
}
