/**
 * Enforces the Electron-ready rules from CLAUDE.md. Run with `vp run check:portability`.
 * Fails on:
 *   - fetch( in src/client outside src/client/api.ts
 *   - process.env outside src/server/paths.ts, src/server/secrets.ts, src/cli/
 *   - process.cwd() outside src/cli/
 *   - node:* / fs / path (and any Node builtin) imports in src/shared or src/client
 *   - better-sqlite3 imported outside src/server/db/db.ts
 */
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOTS = ["src", "tools", "scripts"];
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".svelte"]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listFiles(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Strips line and block comments so that documentation does not trip the rules. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Preserve line count so reported line numbers stay accurate.
      out += source.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const IMPORT_RE = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(line: string): string[] {
  const specs: string[] = [];
  for (const m of line.matchAll(IMPORT_RE)) specs.push(m[1]!);
  return specs;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function check(file: string): Violation[] {
  const r = rel(file);
  const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
  const violations: Violation[] = [];
  const inClient = r.startsWith("src/client/");
  const inShared = r.startsWith("src/shared/");
  const inCli = r.startsWith("src/cli/");
  const isApi = r === "src/client/api.ts";
  const isPaths = r === "src/server/paths.ts";
  const isSecrets = r === "src/server/secrets.ts";
  const isDb = r === "src/server/db/db.ts";
  const isThisScript = r === "scripts/check-portability.ts";

  lines.forEach((text, idx) => {
    const line = idx + 1;
    const add = (rule: string) => violations.push({ file: r, line, rule, text: text.trim() });
    if (inClient && !isApi && /\bfetch\s*\(/.test(text)) add("fetch( outside src/client/api.ts");
    if (/\bprocess\.env\b/.test(text) && !(isPaths || isSecrets || inCli || isThisScript)) {
      add("process.env outside paths.ts, secrets.ts, src/cli/");
    }
    if (/\bprocess\.cwd\s*\(/.test(text) && !(inCli || isThisScript))
      add("process.cwd() outside src/cli/");
    for (const spec of importSpecifiers(text)) {
      if ((inShared || inClient) && BUILTINS.has(spec))
        add(`Node builtin import "${spec}" in src/shared or src/client`);
      if (spec === "better-sqlite3" && !isDb)
        add("better-sqlite3 imported outside src/server/db/db.ts");
    }
  });
  return violations;
}

const files = SCAN_ROOTS.flatMap((d) => listFiles(path.join(ROOT, d)));
const violations = files.flatMap(check);

if (violations.length > 0) {
  console.error(`check-portability: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.rule}\n      ${v.text}`);
  process.exit(1);
}
console.log(`check-portability: OK (${files.length} files scanned)`);
