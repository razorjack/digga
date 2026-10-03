import type { Config } from "../shared/config.ts";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  BACKUP_FIELDS,
  type BackedUpData,
  DECISIONS_BACKUP_VERSION,
  type DecisionsBackup,
  DecisionsBackupSchema,
} from "../shared/decisions-backup.ts";
import { type BackupFile, listDatedFiles } from "./db/backup.ts";
import type { Db } from "./db/db.ts";
import { readBackedUpData } from "./db/user-data.ts";

/** Daily decisions backups kept; older ones are deleted. */
export const DECISIONS_BACKUPS_KEPT = 30;

const DECISIONS_FILE = /^decisions-(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const SECTIONS = Object.keys(BACKUP_FIELDS) as (keyof BackedUpData)[];
const gzip = promisify(zlib.gzip);

export interface DecisionsBackupOptions {
  dir: string;
  /** Local day of the backup, YYYY-MM-DD; see localDay(). */
  day: string;
  now: Date;
  keep?: number;
  config?: Config;
}

/**
 * Writes the day's decisions backup unless the day has one, the library holds nothing made in
 * Digga, or nothing changed since the newest backup. So idle days, and a new or emptied library,
 * never push older backups out. Returns the new backup, or null.
 */
export async function backupDecisionsDaily(
  db: Db,
  options: DecisionsBackupOptions,
): Promise<BackupFile | null> {
  if (fs.existsSync(decisionsPath(options.dir, options.day))) return null;
  const data = readBackedUpData(db);
  if (!hasDiggaData(data)) return null;
  const newest = listDecisionsBackups(options.dir)[0];
  if (newest && unchangedSince(newest.file, data)) return null;
  return saveDecisionsBackup(data, options);
}

/** Writes the day's decisions backup now, replacing one of the same day. */
export async function writeDecisionsBackup(
  db: Db,
  options: DecisionsBackupOptions,
): Promise<BackupFile> {
  return saveDecisionsBackup(readBackedUpData(db), options);
}

/** Decisions backups in the directory, newest first. */
export function listDecisionsBackups(dir: string): BackupFile[] {
  return listDatedFiles(dir, DECISIONS_FILE);
}

/** Reads a decisions backup, gzipped or not; throws when the file is not one. */
export function readDecisionsBackup(file: string): DecisionsBackup {
  const bytes = fs.readFileSync(file);
  const text = file.endsWith(".gz") ? zlib.gunzipSync(bytes).toString("utf8") : bytes.toString();
  const result = DecisionsBackupSchema.safeParse(JSON.parse(text));
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(
    `${file} is not a Digga decisions backup: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`,
  );
}

/**
 * The file's text: the header, then each section with one entry per line, so `gunzip -c` reads
 * well and data that did not change writes the same text.
 */
export function formatDecisionsBackup(backup: DecisionsBackup): string {
  const header = [
    `  "app": "digga"`,
    `  "kind": "decisions"`,
    `  "version": ${backup.version}`,
    `  "backedUpAt": ${JSON.stringify(backup.backedUpAt)}`,
    `  "config": ${JSON.stringify(backup.config ?? null)}`,
  ];
  return `{\n${[...header, formatSections(backup)].join(",\n")}\n}\n`;
}

async function saveDecisionsBackup(
  data: BackedUpData,
  options: DecisionsBackupOptions,
): Promise<BackupFile> {
  const file = decisionsPath(options.dir, options.day);
  const bytes = await writeDecisionsFile(data, options, file);
  for (const old of listDecisionsBackups(options.dir).slice(options.keep ?? DECISIONS_BACKUPS_KEPT))
    fs.rmSync(old.file, { force: true });
  return { file, day: options.day, bytes };
}

function formatSections(data: BackedUpData): string {
  return SECTIONS.map((section) => {
    const entries = data[section].map((entry) => JSON.stringify(entry, BACKUP_FIELDS[section]));
    const list = entries.length === 0 ? "[]" : `[\n    ${entries.join(",\n    ")}\n  ]`;
    return `  ${JSON.stringify(section)}: ${list}`;
  }).join(",\n");
}

/** Anything made in Digga; seeds alone come back from the Discogs and history imports. */
function hasDiggaData(data: BackedUpData): boolean {
  return (
    data.verdicts.some((verdict) => typeof verdict.dugAt === "string") ||
    data.trackMarks.length > 0 ||
    data.heardTunes.length > 0 ||
    data.attachedVideos.length > 0 ||
    data.listenLog.length > 0 ||
    data.verdictLog.some((entry) => entry.source === "triage" || entry.source === "manual") ||
    data.trackMarkLog.length > 0
  );
}

/** A newest backup that cannot be read counts as changed, so a good one is written. */
function unchangedSince(file: string, data: BackedUpData): boolean {
  try {
    return formatSections(readDecisionsBackup(file)) === formatSections(data);
  } catch {
    return false;
  }
}

function decisionsPath(dir: string, day: string): string {
  return path.join(dir, `decisions-${day}.json.gz`);
}

const CHECKPOINT_FILE = /^checkpoint-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json\.gz$/;
export const CHECKPOINTS_KEPT = 48;

export function listCheckpoints(dir: string): BackupFile[] {
  return listDatedFiles(dir, CHECKPOINT_FILE);
}

/** Changed personal data every fifteen minutes, and at a clean server shutdown. */
export async function checkpointDecisions(
  db: Db,
  options: DecisionsBackupOptions,
): Promise<BackupFile | null> {
  const data = readBackedUpData(db);
  const newest = listCheckpoints(options.dir)[0];
  if (
    newest &&
    unchangedSince(newest.file, data) &&
    JSON.stringify(readDecisionsBackup(newest.file).config) ===
      JSON.stringify(options.config ?? null)
  )
    return null;
  const stamp = options.now.toISOString().replace(/[:.]/g, "-");
  const file = path.join(options.dir, `checkpoint-${stamp}.json.gz`);
  const bytes = await writeDecisionsFile(data, options, file);
  for (const old of listCheckpoints(options.dir).slice(CHECKPOINTS_KEPT)) fs.rmSync(old.file);
  return { file, day: stamp, bytes };
}

async function writeDecisionsFile(
  data: BackedUpData,
  options: DecisionsBackupOptions,
  file: string,
): Promise<number> {
  const backup: DecisionsBackup = {
    app: "digga",
    kind: "decisions",
    version: DECISIONS_BACKUP_VERSION,
    backedUpAt: options.now.toISOString(),
    config: options.config ?? null,
    ...data,
  };
  const compressed = await gzip(formatDecisionsBackup(backup), { level: 9 });
  const partial = `${file}.${randomUUID()}.partial`;
  fs.mkdirSync(options.dir, { recursive: true });
  fs.writeFileSync(partial, compressed);
  fs.renameSync(partial, file);
  return compressed.length;
}
