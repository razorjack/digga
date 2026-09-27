import fs from "node:fs";
import path from "node:path";
import { type Config, ConfigSchema, DEFAULT_CONFIG } from "../shared/config.ts";

/**
 * Reads digga.config.json. The file is per-user (username, filters) and gitignored; when it is
 * missing it is created from digga.config.example.json if given, else from the schema defaults.
 */
export function loadConfig(file: string, exampleFile?: string): Config {
  if (!fs.existsSync(file)) {
    const initial =
      exampleFile && fs.existsSync(exampleFile) ? parseFile(exampleFile) : DEFAULT_CONFIG;
    saveConfig(file, initial);
    return initial;
  }
  return parseFile(file);
}

function parseFile(file: string): Config {
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config ${file}: ${problems}`);
  }
  return result.data;
}

export function saveConfig(file: string, config: Config): void {
  const validated = ConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
