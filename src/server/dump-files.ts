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

/**
 * A gzipped releases dump the user keeps anywhere, under any name ending in .xml.gz; whether it
 * holds releases only the load can tell.
 */
export function isDumpFileElsewhere(file: string): boolean {
  if (!file.endsWith(".xml.gz")) return false;
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * Deletes a releases dump the folder lists; false when it has none by that name. Only listed
 * names are accepted, so the name cannot reach outside the folder.
 */
export function deleteDumpFile(dir: string, name: string): boolean {
  if (!listDumpFiles(dir).some((file) => file.name === name)) return false;
  fs.rmSync(path.join(dir, name));
  return true;
}
