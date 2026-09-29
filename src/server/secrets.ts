import fs from "node:fs";
import path from "node:path";
import type { TokenSource } from "../shared/api.ts";

export interface Secrets {
  getDiscogsToken(): string | undefined;
  /** Where the token comes from; a token from the environment cannot be changed in the app. */
  discogsTokenSource(): TokenSource;
  /** Saves the token, or removes the saved one with null. */
  setDiscogsToken(token: string | null): void;
}

const TOKEN_KEY = "DISCOGS_TOKEN";

/** Minimal .env parser: KEY=value lines, optional quotes, # comments. Does not mutate process.env. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const key = dotEnvKey(rawLine);
    if (key === null) continue;
    const line = rawLine.trim();
    let value = line.slice(line.indexOf("=") + 1).trim();
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

/** The key a KEY=value line sets, or null for blank lines, comments and other text. */
function dotEnvKey(rawLine: string): string | null {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) return null;
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  return line
    .slice(0, eq)
    .trim()
    .replace(/^export\s+/, "");
}

/**
 * The .env text with `key` set to `value`, or without it for null. Other lines, comments
 * included, stay as they were; a key set on several lines keeps only its first.
 */
export function withDotEnvValue(text: string, key: string, value: string | null): string {
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const kept: string[] = [];
  let written = false;
  for (const line of lines) {
    if (dotEnvKey(line) !== key) {
      kept.push(line);
      continue;
    }
    if (value !== null && !written) kept.push(`${key}=${value}`);
    written = true;
  }
  if (value !== null && !written) kept.push(`${key}=${value}`);
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

export interface SecretsOptions {
  envFile?: string;
  /** The process environment; tests pass their own. */
  env?: Record<string, string | undefined>;
}

/**
 * Secrets come from the environment first, then from the .env file, which Settings writes.
 * Electron will replace this factory with one backed by safeStorage.
 */
export function createSecrets(options: SecretsOptions): Secrets {
  const env = options.env ?? process.env;
  let fileValues: Record<string, string> | undefined;
  const readFile = (): Record<string, string> => {
    fileValues ??= parseDotEnv(readEnvFile(options.envFile));
    return fileValues;
  };
  const fromEnvironment = () => nonEmpty(env[TOKEN_KEY]);
  const fromFile = () => nonEmpty(readFile()[TOKEN_KEY]);
  return {
    getDiscogsToken: () => fromEnvironment() ?? fromFile(),
    discogsTokenSource() {
      if (fromEnvironment()) return "environment";
      return fromFile() ? "saved" : null;
    },
    setDiscogsToken(token) {
      if (!options.envFile) throw new Error("No .env file to save the token in");
      const text = withDotEnvValue(readEnvFile(options.envFile), TOKEN_KEY, token);
      writePrivateFile(options.envFile, text);
      fileValues = parseDotEnv(text);
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readEnvFile(file: string | undefined): string {
  if (!file || !fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

/** Replaces the file in one step, readable by its owner only. */
function writePrivateFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
