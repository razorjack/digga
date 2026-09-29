import fs from "node:fs";
import path from "node:path";
import type { DumpFile } from "../shared/api.ts";

const DUMP_FILE = /^discogs_(\d{4})(\d{2})(\d{2})_releases\.xml(\.gz)?$/;

/** The releases dumps in the folder, newest first. Partial downloads end in .part and are left out. */
export function listDumpFiles(dir: string): DumpFile[] {
  if (!fs.existsSync(dir)) return [];
  const files: DumpFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = DUMP_FILE.exec(name);
    if (!match) continue;
    const bytes = fs.statSync(path.join(dir, name)).size;
    files.push({ name, date: `${match[1]}-${match[2]}-${match[3]}`, bytes });
  }
  return files.sort((left, right) => right.date.localeCompare(left.date));
}
