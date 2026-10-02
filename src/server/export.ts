import type { DecisionsExport, ExportFile } from "../shared/api.ts";
import { toCsv } from "../shared/csv.ts";
import type { Db } from "./db/db.ts";
import { listTrackMarkExports, listVerdictExports } from "./db/export.ts";

const RELEASE_HEADER = ["release_id", "artist", "title", "label", "catno", "year", "country"];

export interface ExportDocument {
  body: string;
  contentType: string;
}

/** The export file's contents: every verdict and track mark, as JSON or as CSV. */
export function buildExport(db: Db, file: ExportFile, now: Date): ExportDocument {
  switch (file) {
    case "decisions.json":
      return { body: decisionsJson(db, now), contentType: "application/json; charset=utf-8" };
    case "verdicts.csv":
      return { body: verdictsCsv(db), contentType: "text/csv; charset=utf-8" };
    case "track-marks.csv":
      return { body: trackMarksCsv(db), contentType: "text/csv; charset=utf-8" };
  }
}

function decisionsJson(db: Db, now: Date): string {
  const decisions: DecisionsExport = {
    app: "digga",
    exportedAt: now.toISOString(),
    verdicts: listVerdictExports(db),
    trackMarks: listTrackMarkExports(db),
  };
  return JSON.stringify(decisions, null, 2);
}

function verdictsCsv(db: Db): string {
  const header = ["key", "status", "source", "decided_at", "dug_at", "notes", ...RELEASE_HEADER];
  const rows = listVerdictExports(db).map((verdict) => [
    verdict.key,
    verdict.status,
    verdict.source,
    verdict.decidedAt,
    verdict.dugAt,
    verdict.notes,
    verdict.releaseId,
    verdict.artist,
    verdict.title,
    verdict.label,
    verdict.catno,
    verdict.year,
    verdict.country,
  ]);
  return toCsv(header, rows);
}

function trackMarksCsv(db: Db): string {
  const header = [
    "position",
    "mark",
    "decided_at",
    "notes",
    "track_artist",
    "track_title",
    "video_id",
    "at_seconds",
    ...RELEASE_HEADER,
  ];
  const rows = listTrackMarkExports(db).map((mark) => [
    mark.position,
    mark.mark,
    mark.decidedAt,
    mark.notes,
    mark.trackArtist,
    mark.trackTitle,
    mark.videoId,
    mark.atSeconds,
    mark.releaseId,
    mark.artist,
    mark.title,
    mark.label,
    mark.catno,
    mark.year,
    mark.country,
  ]);
  return toCsv(header, rows);
}
