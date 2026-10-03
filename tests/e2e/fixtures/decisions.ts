import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { formatDecisionsBackup } from "../../../src/server/decisions-backup.ts";
import {
  type BackedUpData,
  DECISIONS_BACKUP_VERSION,
  type DecisionsBackup,
} from "../../../src/shared/decisions-backup.ts";
import type { VerdictInput } from "../../../src/shared/api.ts";
import type { VerdictStatus } from "../../../src/shared/types.ts";
import { BULK, type FixtureRelease, triageKeyOf } from "./catalogue.ts";

/**
 * Decisions backups as `digga backup` writes them, for given state too large to write through the
 * API one verdict at a time (docs/e2e/FIXTURES.md#libraries).
 */

/** When the generated backups were written; their verdicts were decided before it. */
const BACKED_UP_AT = "2026-09-30T12:00:00.000Z";

export interface DatedVerdict {
  release: FixtureRelease;
  status: VerdictStatus;
  notes?: string;
}

/**
 * Verdicts for given.verdict(), a day apart and the first one newest, so Twelves' newest-first
 * order is the list's order whatever the clock says.
 */
export function datedVerdicts(verdicts: DatedVerdict[]): VerdictInput[] {
  const newest = Date.parse(BACKED_UP_AT) - 86_400_000;
  return verdicts.map((verdict, index) => ({
    key: triageKeyOf(verdict.release),
    status: verdict.status,
    source: "triage",
    notes: verdict.notes ?? null,
    releaseId: verdict.release.id,
    decidedAt: new Date(newest - index * 86_400_000).toISOString(),
  }));
}

/** A backup that holds these verdicts and nothing else. */
export function decisionsBackup(verdicts: BackedUpData["verdicts"]): DecisionsBackup {
  return {
    app: "digga",
    kind: "decisions",
    version: DECISIONS_BACKUP_VERSION,
    backedUpAt: BACKED_UP_AT,
    verdicts,
    trackMarks: [],
    heardTunes: [],
    attachedVideos: [],
    noAudioVideos: [],
    sessions: [],
    releaseNotes: [],
    listenLog: [],
    verdictLog: [],
    trackMarkLog: [],
    config: null,
  };
}

/**
 * A verdict on each of the first `count` bulk records, a second apart and the first one newest, so
 * Twelves' newest-first order is the catalogue's order.
 */
export function bulkVerdicts(count: number, status: VerdictStatus): BackedUpData["verdicts"] {
  if (count > BULK.length) throw new Error(`the bulk catalogue has ${BULK.length} records`);
  const newest = Date.parse(BACKED_UP_AT) - 60_000;
  return BULK.slice(0, count).map((fixture, index) => ({
    key: triageKeyOf(fixture),
    status,
    source: "triage",
    notes: null,
    releaseId: fixture.id,
    decidedAt: new Date(newest - index * 1000).toISOString(),
  }));
}

/** Writes the backup gzipped into the folder, under the name `digga backup` gives it. */
export function writeDecisionsBackup(folder: string, backup: DecisionsBackup): string {
  const file = path.join(folder, `decisions-${backup.backedUpAt.slice(0, 10)}.json.gz`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(formatDecisionsBackup(backup)));
  return file;
}
