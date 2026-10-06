import fs from "node:fs";
import path from "node:path";
import type { TokenSource } from "../shared/api.ts";

export interface Secrets {
  getDiscogsToken(): string | undefined;
  /** Where the token comes from; a token from the environment cannot be changed in the app. */
  discogsTokenSource(): TokenSource;
  /** Whether the saved token is stored encrypted; false without a saved token. */
  discogsTokenEncrypted(): boolean;
  /** Saves the token, or removes the saved one with null. */
  setDiscogsToken(token: string | null): void;
}

/** The system's encryption for secrets: Electron's safeStorage in the app. */
export interface SecretEncryption {
  /** False where the system has no key store to encrypt with, such as Linux without a keyring. */
  isAvailable(): boolean;
  /** Text to store, such as base64 of the encrypted bytes. */
  encrypt(text: string): string;
  /** Throws for text this system cannot decrypt. */
  decrypt(stored: string): string;
}

const TOKEN_KEY = "DISCOGS_TOKEN";
const ENCRYPTED_TOKEN_KEY = "DISCOGS_TOKEN_ENCRYPTED";

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
  /** Encrypts the saved token when it is available; without it the token is saved as text. */
  encryption?: SecretEncryption;
}

interface SavedToken {
  token: string;
  encrypted: boolean;
}

/**
 * The token comes from the environment first, then from the .env file, which Settings writes.
 * With encryption the file holds DISCOGS_TOKEN_ENCRYPTED, which a process without the same
 * encryption cannot read; a token saved as text, by the browser version or where encryption is
 * unavailable, keeps working. Each save replaces both forms.
 */
export function createSecrets(options: SecretsOptions): Secrets {
  const env = options.env ?? process.env;
  const encryption = options.encryption ?? null;
  let saved: SavedToken | null | undefined;
  const readSaved = (): SavedToken | null => {
    if (saved === undefined) saved = readSavedToken(readEnvFile(options.envFile), encryption);
    return saved;
  };
  const fromEnvironment = () => nonEmpty(env[TOKEN_KEY]);
  return {
    getDiscogsToken: () => fromEnvironment() ?? readSaved()?.token,
    discogsTokenSource() {
      if (fromEnvironment()) return "environment";
      return readSaved() ? "saved" : null;
    },
    discogsTokenEncrypted: () => readSaved()?.encrypted ?? false,
    setDiscogsToken(token) {
      if (!options.envFile) throw new Error("No .env file to save the token in");
      const text = withSavedToken(readEnvFile(options.envFile), token, encryption);
      writePrivateFile(options.envFile, text);
      saved = readSavedToken(text, encryption);
    },
  };
}

/** An encrypted token this process cannot decrypt counts as none, so the user can save it again. */
function readSavedToken(text: string, encryption: SecretEncryption | null): SavedToken | null {
  const values = parseDotEnv(text);
  const encrypted = nonEmpty(values[ENCRYPTED_TOKEN_KEY]);
  const token = encrypted && encryption ? decryptOrNull(encryption, encrypted) : null;
  if (token) return { token, encrypted: true };
  const plain = nonEmpty(values[TOKEN_KEY]);
  return plain ? { token: plain, encrypted: false } : null;
}

function decryptOrNull(encryption: SecretEncryption, stored: string): string | null {
  try {
    return nonEmpty(encryption.decrypt(stored)) ?? null;
  } catch {
    return null;
  }
}

/** The .env text with the token encrypted when encryption is available, else as text; null removes it. */
function withSavedToken(
  text: string,
  token: string | null,
  encryption: SecretEncryption | null,
): string {
  const encrypted = token !== null && encryption?.isAvailable() ? encryption.encrypt(token) : null;
  const plain = encrypted === null ? token : null;
  return withDotEnvValue(withDotEnvValue(text, ENCRYPTED_TOKEN_KEY, encrypted), TOKEN_KEY, plain);
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
