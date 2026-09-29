import type { Stats } from "../shared/api.ts";
import { formatBytes } from "../shared/display.ts";
import type { DumpDownloadProgress } from "../shared/types.ts";
import type { DumpDownloadResult } from "../server/jobs/dump-download.ts";
import type { BackupFile } from "../server/db/backup.ts";
import type { Filters } from "../shared/config.ts";
import type { DumpLoadJobResult } from "../server/jobs/dump-load.ts";
import type { EnrichResult } from "../server/jobs/enrich.ts";
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
    console.log(
      `import seller ${result.username}: ${read} listings read, ${result.records ?? 0} of their records are loaded; F in Triage digs them`,
    );
    return;
  }
  if (result.kind === "list") {
    console.log(
      `import list "${result.listName}": ${result.processed} items, ${result.stubs} stub releases, ${result.verdictsWritten} verdicts written`,
    );
    return;
  }
  console.log(
    `import ${result.kind}: ${result.processed} items over ${result.pages ?? 0} page(s), ${result.stubs} stub releases, ${result.verdictsWritten} verdicts written`,
  );
}

export function showEnrichment(result: EnrichResult): void {
  const aborted = result.aborted ? ", aborted" : "";
  console.log(
    `enrich: ${result.done}/${result.total} releases enriched, ${result.failed} failed${aborted}`,
  );
}

export function showBackup(backup: BackupFile): void {
  console.log(`backup: ${backup.file} (${formatBytes(backup.bytes)})`);
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
    `enriched:  ${stats.remainingEnriched.toLocaleString()} of ${stats.remaining.toLocaleString()} records to dig`,
  );
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
