import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, DEFAULT_CONFIG, type Config } from "../shared/config.ts";

/** Reads digga.config.json, creating it with defaults when missing. */
export function loadConfig(file: string): Config {
  if (!fs.existsSync(file)) {
    saveConfig(file, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
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
