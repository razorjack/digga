import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { z } from "zod";
import type { Config } from "../shared/config.ts";
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
import { runWorker } from "./jobs/worker.ts";
import type { Logger } from "./logger.ts";

/** Daily decisions backups kept; older ones are deleted. */
export const DECISIONS_BACKUPS_KEPT = 30;
/** Checkpoints kept besides the daily backups: half a day of fifteen-minute checks. */
export const CHECKPOINTS_KEPT = 48;

const DECISIONS_FILE = /^decisions-(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const CHECKPOINT_FILE = /^checkpoint-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json\.gz$/;
const gzip = promisify(zlib.gzip);

type Section = keyof BackedUpData;

/** The record type each section's lines carry, in file order. */
const RECORD_TYPES: Record<Section, string> = {
  verdicts: "verdict",
  memberships: "membership",
  trackMarks: "trackMark",
  heardTunes: "heardTune",
  attachedVideos: "attachedVideo",
  noAudioVideos: "noAudioVideos",
  releaseNotes: "releaseNote",
  sessions: "session",
  listenLog: "listen",
  verdictLog: "verdictEvent",
  trackMarkLog: "trackMarkEvent",
};
const SECTIONS = Object.keys(RECORD_TYPES) as Section[];
const SECTION_OF_RECORD = new Map(SECTIONS.map((section) => [RECORD_TYPES[section], section]));
/** Sections that hold database rows, whose columns the file names in camelCase. */
const ROW_SECTIONS = new Set<Section>([
  "releaseNotes",
  "sessions",
  "listenLog",
  "verdictLog",
  "trackMarkLog",
]);

export interface DecisionsBackupOptions {
  dir: string;
  /** Local day of the backup, YYYY-MM-DD; see localDay(). */
  day: string;
  now: Date;
  keep?: number;
  config?: Config;
}

/** A backup the server writes: the day's, a checkpoint, or the day's now (Back up now). */
export interface DecisionsBackupTask {
  backup: "daily" | "checkpoint" | "now";
  options: DecisionsBackupOptions;
}

const BACKUP_WORKER = new URL("./decisions-backup-worker.ts", import.meta.url);

/**
 * Writes a backup in a worker with its own connection: reading and formatting a long listening
 * history takes seconds, which the server thread must not spend. The connection only reads, but
 * opens the library as the server does, since a read-only one would miss what the server's
 * write-ahead log holds. An in-memory database cannot be shared, so it is backed up inline.
 */
export function backUpDecisionsInWorker(
  db: Db,
  dbFile: string,
  task: DecisionsBackupTask,
  logger: Logger,
): Promise<BackupFile | null> {
  if (dbFile === ":memory:") return runDecisionsBackupTask(db, task);
  const job = { signal: new AbortController().signal, onProgress: () => {} };
  const workerData = { ...task, dbFile };
  return runWorker<BackupFile | null, never>(BACKUP_WORKER, { workerData, job, logger });
}

export function runDecisionsBackupTask(
  db: Db,
  task: DecisionsBackupTask,
): Promise<BackupFile | null> {
  if (task.backup === "daily") return backupDecisionsDaily(db, task.options);
  if (task.backup === "checkpoint") return checkpointDecisions(db, task.options);
  return writeDecisionsBackup(db, task.options);
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
  const records = formatRecords(data);
  const newest = listDecisionsBackups(options.dir)[0];
  if (newest && (await savedHeader(newest.file))?.dataHash === records.dataHash) return null;
  return saveDecisionsBackup(records, options);
}

/** Writes the day's decisions backup now, replacing one of the same day. */
export async function writeDecisionsBackup(
  db: Db,
  options: DecisionsBackupOptions,
): Promise<BackupFile> {
  return saveDecisionsBackup(formatRecords(readBackedUpData(db)), options);
}

/**
 * Writes a checkpoint when personal data or settings changed since the newest one. The server
 * checks every fifteen minutes and once more at a clean shutdown.
 */
export async function checkpointDecisions(
  db: Db,
  options: DecisionsBackupOptions,
): Promise<BackupFile | null> {
  const records = formatRecords(readBackedUpData(db));
  const newest = listCheckpoints(options.dir)[0];
  if (newest && sameCheckpoint(await savedHeader(newest.file), records, options.config))
    return null;

  const stamp = options.now.toISOString().replace(/[:.]/g, "-");
  const file = path.join(options.dir, `checkpoint-${stamp}.json.gz`);
  const bytes = await writeDecisionsFile(records, options, file);
  for (const old of listCheckpoints(options.dir).slice(CHECKPOINTS_KEPT)) fs.rmSync(old.file);
  return { file, day: stamp, bytes };
}

/** Decisions backups in the directory, newest first. */
export function listDecisionsBackups(dir: string): BackupFile[] {
  return listDatedFiles(dir, DECISIONS_FILE);
}

/** Checkpoints in the directory, newest first. */
export function listCheckpoints(dir: string): BackupFile[] {
  return listDatedFiles(dir, CHECKPOINT_FILE);
}

/** Reads a decisions backup, gzipped or not; throws when the file is not one. */
export function readDecisionsBackup(file: string): DecisionsBackup {
  const bytes = fs.readFileSync(file);
  const text = file.endsWith(".gz") ? zlib.gunzipSync(bytes).toString("utf8") : bytes.toString();
  return parseDecisionsBackup(text, file);
}

/**
 * A backup's text: a version 3 file has a header line, then one record per line; versions 1 and 2
 * are one JSON document over several lines. Throws when the text is not a backup this Digga reads.
 */
export function parseDecisionsBackup(text: string, file: string): DecisionsBackup {
  const parsed = backupObject(text);
  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > DECISIONS_BACKUP_VERSION)
    throw new Error(
      `${file} was written by a newer Digga (backup format ${version}); this version reads formats up to ${DECISIONS_BACKUP_VERSION}.`,
    );

  const result = DecisionsBackupSchema.safeParse(parsed);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(
    `${file} is not a Digga decisions backup: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`,
  );
}

/**
 * The file's text: a header line, then one record per line in a fixed field order, so data that
 * did not change writes the same lines, and `gunzip -c` reads well. The header holds a hash of
 * the record lines, which tells whether a later backup would hold anything new.
 */
export function formatDecisionsBackup(backup: DecisionsBackup): string {
  return backupText(formatRecords(backup), {
    backedUpAt: backup.backedUpAt,
    config: backup.config ?? null,
  });
}

/** The record lines of a backup's data, and their hash. */
interface BackupRecords {
  lines: string[];
  dataHash: string;
}

function formatRecords(data: BackedUpData): BackupRecords {
  const lines = SECTIONS.flatMap((section) =>
    data[section].map((entry) => recordLine(section, entry)),
  );
  const dataHash = createHash("sha256").update(lines.join("\n")).digest("hex");
  return { lines, dataHash };
}

function backupText(
  records: BackupRecords,
  header: { backedUpAt: string; config: unknown },
): string {
  const headerLine = JSON.stringify({
    app: "digga",
    kind: "decisions",
    version: DECISIONS_BACKUP_VERSION,
    backedUpAt: header.backedUpAt,
    dataHash: records.dataHash,
    config: header.config,
  });
  return `${[headerLine, ...records.lines].join("\n")}\n`;
}

/** One record: its type, then its fields in file order, named in camelCase. */
function recordLine(section: Section, entry: object): string {
  const values = new Map(Object.entries(entry));
  const fields = BACKUP_FIELDS[section].map((field) => [fileField(field), values.get(field)]);
  return JSON.stringify(Object.fromEntries([["record", RECORD_TYPES[section]], ...fields]));
}

/**
 * The backup as one object: a version 3 header with the sections its records fill, or the JSON
 * document of an older version.
 */
function backupObject(text: string): unknown {
  const lineEnd = text.indexOf("\n");
  const header = completeJson(lineEnd === -1 ? text : text.slice(0, lineEnd));
  if (header === undefined) return JSON.parse(text);
  if (lineEnd === -1) return header;
  return { ...sectionsOf(text.slice(lineEnd + 1).split("\n")), ...(header as object) };
}

/** The value a line holds, or undefined when it is not JSON on its own. */
function completeJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/** Each record line in its section, with the field names the sections use. */
function sectionsOf(lines: string[]): Record<Section, unknown[]> {
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, [] as unknown[]]));
  for (const line of lines) {
    if (line.trim() === "") continue;
    const { record, ...fields } = RecordLineSchema.parse(JSON.parse(line));
    const section = SECTION_OF_RECORD.get(record);
    if (section === undefined) throw new Error(`a record of unknown type "${record}"`);
    sections[section]!.push(sectionFields(section, fields));
  }
  return sections as Record<Section, unknown[]>;
}

const RecordLineSchema = z.looseObject({ record: z.string() });

/** The record's fields under the names its section uses: database columns for the logged rows. */
function sectionFields(section: Section, fields: Record<string, unknown>): Record<string, unknown> {
  if (!ROW_SECTIONS.has(section)) return fields;
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [columnName(name), value]),
  );
}

/** `release_id` -> `releaseId`: the file names every field in camelCase. */
function fileField(name: string): string {
  return name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** `releaseId` -> `release_id`, for the sections that hold database rows. */
function columnName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The header of the newest backup: its data hash and settings; null when it cannot be read. */
async function savedHeader(file: string): Promise<{ dataHash?: unknown; config?: unknown } | null> {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) return (completeJson(line) as object | undefined) ?? null;
    return null;
  } catch {
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function saveDecisionsBackup(
  records: BackupRecords,
  options: DecisionsBackupOptions,
): Promise<BackupFile> {
  const file = decisionsPath(options.dir, options.day);
  const bytes = await writeDecisionsFile(records, options, file);
  for (const old of listDecisionsBackups(options.dir).slice(options.keep ?? DECISIONS_BACKUPS_KEPT))
    fs.rmSync(old.file, { force: true });
  return { file, day: options.day, bytes };
}

/**
 * Anything an import cannot bring back: the account's items come back from the imports, while a
 * verdict was made in Digga or seen in the browser history import it no longer has (decision 171).
 */
function hasDiggaData(data: BackedUpData): boolean {
  return (
    data.verdicts.length > 0 ||
    data.trackMarks.length > 0 ||
    data.heardTunes.length > 0 ||
    data.attachedVideos.length > 0 ||
    data.releaseNotes.length > 0 ||
    data.listenLog.length > 0 ||
    data.verdictLog.some((entry) => entry.source === "triage" || entry.source === "manual") ||
    data.trackMarkLog.length > 0 ||
    data.sessions.length > 0
  );
}

function decisionsPath(dir: string, day: string): string {
  return path.join(dir, `decisions-${day}.json.gz`);
}

/** A checkpoint holds the same data and settings as the newest one. */
function sameCheckpoint(
  saved: { dataHash?: unknown; config?: unknown } | null,
  records: BackupRecords,
  config?: Config,
): boolean {
  if (saved?.dataHash !== records.dataHash) return false;
  return JSON.stringify(saved.config ?? null) === JSON.stringify(config ?? null);
}

async function writeDecisionsFile(
  records: BackupRecords,
  options: DecisionsBackupOptions,
  file: string,
): Promise<number> {
  const text = backupText(records, {
    backedUpAt: options.now.toISOString(),
    config: options.config ?? null,
  });
  const compressed = await gzip(text, { level: 9 });

  // A write interrupted halfway must not count as a backup; concurrent writers use their own file.
  const partial = `${file}.${randomUUID()}.partial`;
  fs.mkdirSync(options.dir, { recursive: true });
  fs.writeFileSync(partial, compressed);
  fs.renameSync(partial, file);
  return compressed.length;
}
