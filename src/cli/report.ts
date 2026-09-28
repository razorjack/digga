import type { Stats } from "../shared/api.ts";
import type { Filters } from "../shared/config.ts";
import type { DumpLoadResult } from "../../tools/dump/load.ts";
import type { EnrichResult } from "../server/jobs/enrich.ts";
import type { ImportResult } from "./commands.ts";

export function showDump(result: DumpLoadResult): void {
  const written = result.dryRun
    ? "dry run, nothing written"
    : `upserted ${result.upserted.toLocaleString()}`;
  const date = result.dumpDate ? ` (dump ${result.dumpDate})` : "";
  console.log(
    `dump load: scanned ${result.scanned.toLocaleString()} releases, matched ${result.matched.toLocaleString()}, ${written} in ${result.elapsedSeconds.toFixed(0)}s${date}`,
  );
}

export function showImport(result: ImportResult): void {
  if (result.kind === "history") {
    console.log(
      `import history: ${result.files} file(s), ${result.discogsUrls} Discogs URLs, ${result.keys} releases/masters marked seen (${result.verdictsWritten} new)`,
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
  const rate =
    stats.rate.verdictsPerHour === null
      ? "n/a"
      : `${stats.rate.verdictsPerHour}/h over ${stats.rate.sessions} session(s)`;
  const eta = stats.rate.etaHours === null ? "n/a" : `${stats.rate.etaHours} h`;
  console.log(
    `dug:       ${stats.dug.toLocaleString()}, ${stats.remaining.toLocaleString()} to go, rate ${rate}, ETA ${eta}`,
  );
}
