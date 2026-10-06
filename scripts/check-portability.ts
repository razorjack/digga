/**
 * Enforces the Electron-ready rules from AGENTS.md. Run with `vp run check:portability`.
 * Fails on:
 *   - fetch( in src/client outside src/client/api.ts
 *   - process.env outside src/server/paths.ts, src/server/secrets.ts, src/cli/
 *   - process.cwd() outside src/cli/
 *   - node:* / fs / path (and any Node builtin) imports in src/shared or src/client
 *   - better-sqlite3 imported outside src/server/db/db.ts
 *   - electron imported outside electron/, so the server stays a function any shell can call
 * The Electron main process in electron/ is held to the same rules as the server.
 */
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["src", "tools", "scripts", "electron"];
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".svelte"]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const BUILTINS = new Set(builtinModules.flatMap((match) => [match, `node:${match}`]));

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      output.push(...listFiles(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      output.push(full);
    }
  }
  return output;
}

/** Strips line and block comments so that documentation does not trip the rules. */
const QUOTES = new Set(['"', "'", "`"]);

function stripComments(source: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];
    if (quote) {
      output += character;
      if (character === "\\" && next !== undefined) {
        output += next;
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (QUOTES.has(character)) {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Preserve line count so reported line numbers stay accurate.
      output += source.slice(index, stop).replace(/[^\n]/g, "");
      index = stop;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

const IMPORT_RE = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(line: string): string[] {
  const specs: string[] = [];
  for (const match of line.matchAll(IMPORT_RE)) specs.push(match[1]!);
  return specs;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function check(file: string): Violation[] {
  const relative = rel(file);
  const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
  return lines.flatMap((text, index) => {
    const rules = [...runtimeViolations(relative, text), ...importViolations(relative, text)];
    return rules.map((rule) => ({ file: relative, line: index + 1, rule, text: text.trim() }));
  });
}

function runtimeViolations(file: string, text: string): string[] {
  const violations: string[] = [];
  const cli = file.startsWith("src/cli/");
  const checker = file === "scripts/check-portability.ts";
  const environmentOwner =
    cli || checker || file === "src/server/paths.ts" || file === "src/server/secrets.ts";
  if (file.startsWith("src/client/") && file !== "src/client/api.ts" && /\bfetch\s*\(/.test(text))
    violations.push("fetch( outside src/client/api.ts");
  if (/\bprocess\.env\b/.test(text) && !environmentOwner)
    violations.push("process.env outside paths.ts, secrets.ts, src/cli/");
  if (/\bprocess\.cwd\s*\(/.test(text) && !(cli || checker))
    violations.push("process.cwd() outside src/cli/");
  return violations;
}

function importViolations(file: string, text: string): string[] {
  const violations: string[] = [];
  const browserCode = file.startsWith("src/shared/") || file.startsWith("src/client/");
  for (const specifier of importSpecifiers(text)) {
    if (browserCode && BUILTINS.has(specifier))
      violations.push(`Node builtin import "${specifier}" in src/shared or src/client`);
    if (specifier === "better-sqlite3" && file !== "src/server/db/db.ts")
      violations.push("better-sqlite3 imported outside src/server/db/db.ts");
    if (specifier === "electron" && !file.startsWith("electron/"))
      violations.push("electron imported outside electron/");
  }
  return violations;
}

const files = SCAN_ROOTS.flatMap((d) => listFiles(path.join(ROOT, d)));
const violations = files.flatMap(check);

if (violations.length > 0) {
  console.error(`check-portability: ${violations.length} violation(s)`);
  for (const violation of violations)
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.rule}\n      ${violation.text}`,
    );
  process.exit(1);
}
console.log(`check-portability: OK (${files.length} files scanned)`);
