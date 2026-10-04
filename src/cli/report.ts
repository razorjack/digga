import type { Stats } from "../shared/api.ts";
import { formatBytes } from "../shared/display.ts";
import type { DumpDownloadProgress } from "../shared/types.ts";
import type { DumpDownloadResult } from "../server/jobs/dump-download.ts";
import type { BackupFile } from "../server/db/backup.ts";
import type { RestoredDatabase } from "../server/db/restore-copy.ts";
import type { RestoreOutcome } from "../server/db/user-data.ts";
import type { DecisionsBackup } from "../shared/decisions-backup.ts";
import type { Filters } from "../shared/config.ts";
import type { StyleCensus } from "../shared/style-census.ts";
import type { DumpLoadJobResult } from "../server/jobs/dump-load.ts";
import type { ImportResult } from "./commands.ts";

/** Prints the download's progress in steps of a tenth. */
export function downloadReporter(): (progress: DumpDownloadProgress) => void {
  let printed = 0;
  return ({ phase, receivedBytes, totalBytes }) => {
    if (phase !== "downloading" || !totalBytes) return;
    const tenths = Math.floor((receivedBytes / totalBytes) * 10);
    if (tenths <= printed) return;
    printed = tenths;
    console.log(`  ${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`);
  };
}

export function showDownload(result: DumpDownloadResult): void {
  const outcome = result.alreadyDownloaded
    ? "downloaded before"
    : `${formatBytes(result.receivedBytes)}, checksum verified`;
  console.log(`dump download: ${result.path} (${outcome})`);
}

export function showCensus(written: { census: StyleCensus; out: string; bytes: number }): void {
  const { census, out, bytes } = written;
  const date = census.dumpDate ? ` (dump ${census.dumpDate})` : "";
  console.log(
    `style census: ${census.styles.length.toLocaleString()} styles in ${census.releases.toLocaleString()} releases${date}, ${formatBytes(bytes)} written to ${out}`,
  );
}

export function showDump(result: DumpLoadJobResult): void {
  const written = result.dryRun
    ? "dry run, nothing written"
    : `upserted ${result.upserted.toLocaleString()}`;
  const date = result.dumpDate ? ` (dump ${result.dumpDate})` : "";
  const covered =
    result.coverage > 0 ? ` (+${result.coverage.toLocaleString()} for their label or artist)` : "";
  console.log(
    `dump load: scanned ${result.scanned.toLocaleString()} releases, matched ${result.matched.toLocaleString()}${covered}, ${written} in ${result.elapsedSeconds.toFixed(0)}s${date}`,
  );
  if (!result.load) return;
  const missing = result.load.missing ? `; ${result.load.missing.toLocaleString()} not found` : "";
  console.log(`  ${result.load.added.toLocaleString()} new releases${missing}`);
}

export function showImport(result: ImportResult): void {
  if (result.kind === "history") {
    console.log(
      `import history: ${result.files} file(s), ${result.discogsUrls} Discogs URLs, ${result.keys} releases/masters marked seen (${result.verdictsWritten} new)`,
    );
    return;
  }
  if (result.kind === "seller") {
    const cut = result.listings !== null && result.read < result.listings;
    const read = cut ? `${result.read} of ${result.listings}` : `${result.read}`;
    const changes =
      result.gone === null
        ? ""
        : `; ${result.gone} releases gone and ${result.added} new since the last read`;
    console.log(
      `import seller ${result.username}: ${read} listings read, ${result.records ?? 0} of their records are loaded${changes}; F in Triage digs them`,
    );
    return;
  }
  if (result.kind === "list") {
    console.log(
      `import list "${result.listName}": ${result.processed} items, ${result.stubs} stub releases, ${result.added} new, ${result.removed} gone from Discogs`,
    );
    return;
  }
  console.log(
    `import ${result.kind}: ${result.processed} items over ${result.pages ?? 0} page(s), ${result.stubs} stub releases, ${result.added} new, ${result.removed} gone from Discogs`,
  );
}

export function showBackup(backup: BackupFile): void {
  console.log(`backup: ${backup.file} (${formatBytes(backup.bytes)})`);
}

export function showDatabaseRestore(restored: RestoredDatabase): void {
  if (restored.previous) console.log(`copied the database first: ${restored.previous}`);
  const upgraded =
    restored.schemaVersion > restored.copyVersion ? `, upgraded to ${restored.schemaVersion}` : "";
  console.log(`restored ${restored.file}, schema version ${restored.copyVersion}${upgraded}`);
}

export function showDecisionsRestore(restore: {
  file: string;
  backup: DecisionsBackup;
  copy: BackupFile;
  outcome: RestoreOutcome;
}): void {
  const { verdicts, memberships, trackMarks, heardTunes, attachedVideos, sessions } =
    restore.outcome;
  const kept = (count: number) =>
    count > 0 ? `, ${count} kept: decided here after the backup` : "";
  const moved =
    verdicts.moved > 0 ? `, ${verdicts.moved} on the record their release is on now` : "";
  console.log(`copied the database first: ${restore.copy.file}`);
  console.log(`restored ${restore.file}, backed up ${restore.backup.backedUpAt}`);
  console.log(
    `  verdicts:        ${verdicts.restored} restored${moved}${kept(verdicts.keptNewer)}`,
  );
  console.log(`  Discogs items:   ${memberships.restored} restored`);
  console.log(`  track marks:     ${trackMarks.restored} restored${kept(trackMarks.keptNewer)}`);
  console.log(`  heard tunes:     ${heardTunes.added} added`);
  console.log(`  attached videos: ${attachedVideos.added} added`);
  const unresumable =
    sessions.leftOut > 0 ? `, ${sessions.leftOut} left out: this version cannot resume them` : "";
  console.log(`  sessions:        ${sessions.restored} restored${unresumable}`);
}

export function showStats(stats: Stats, filters: Filters): void {
  const years = `${filters.yearFrom ?? "…"}-${filters.yearTo ?? "…"}${filters.includeUnknownYear ? " (+unknown)" : ""}`;
  console.log(
    `universe:  ${stats.universe.releases.toLocaleString()} releases, ${stats.universe.keys.toLocaleString()} triage keys`,
  );
  console.log(
    `filtered:  ${stats.universe.filteredKeys.toLocaleString()} keys (${years}, ${filters.formats.join("/") || "any format"})`,
  );
  console.log(
    `verdicts:  ${Object.entries(stats.verdicts)
      .map(([status, count]) => `${status}=${count}`)
      .join(" ")}`,
  );
  console.log(`heard:     ${stats.heardTracks.toLocaleString()} tracks`);
  console.log(
    `dump:      ${stats.dump.date ?? (stats.dump.loadedAt ? "unknown date" : "not loaded")}${stats.dump.loadedAt ? ` (loaded ${stats.dump.loadedAt})` : ""}`,
  );
  const load = stats.dump.lastLoad;
  if (load)
    console.log(
      `last load: ${load.added.toLocaleString()} new releases, ${load.toDig.toLocaleString()} of their records to dig`,
    );
  const rate =
    stats.rate.verdictsPerHour === null
      ? "n/a"
      : `${stats.rate.verdictsPerHour}/h over ${stats.rate.sessions} session(s)`;
  const eta = stats.rate.etaHours === null ? "n/a" : `${stats.rate.etaHours} h`;
  console.log(
    `dug:       ${stats.dug.toLocaleString()}, ${stats.remaining.toLocaleString()} to go, rate ${rate}, ETA ${eta}`,
  );
}
