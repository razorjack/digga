import fs from "node:fs";
import path from "node:path";
import { type Config, ConfigSchema, DEFAULT_CONFIG } from "../shared/config.ts";

/**
 * Reads digga.config.json, the user's settings (username, filters); when it is missing it is
 * created from the schema defaults, which digga.config.example.json shows.
 */
export function loadConfig(file: string): Config {
  if (!fs.existsSync(file)) {
    saveConfig(file, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  return parseFile(file);
}

/** digga.config.json is not JSON or breaks the schema, as after a hand edit. */
export class InvalidConfigError extends Error {
  readonly file: string;

  constructor(file: string, problems: string) {
    super(`Invalid config ${file}: ${problems}`);
    this.name = "InvalidConfigError";
    this.file = file;
  }
}

function parseFile(file: string): Config {
  const result = ConfigSchema.safeParse(readJson(file));
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new InvalidConfigError(file, problems);
  }
  return result.data;
}

function readJson(file: string): unknown {
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InvalidConfigError(file, (error as SyntaxError).message);
  }
}

export function saveConfig(file: string, config: Config): void {
  const validated = ConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
