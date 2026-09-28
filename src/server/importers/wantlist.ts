import type { ImportProgress } from "../../shared/types.ts";
import { applySeedItem } from "./seeds.ts";
import type { SeedImportDeps, SeedImportOptions, SeedImportResult } from "./collection.ts";

export async function importWantlist(
  deps: SeedImportDeps,
  options: SeedImportOptions,
  onProgress?: (p: ImportProgress) => void,
): Promise<SeedImportResult> {
  if (options.username === "") throw new Error("discogs.username is not set in digga.config.json");
  const perPage = options.perPage ?? 100;
  const progress: ImportProgress = {
    page: 0,
    pages: null,
    processed: 0,
    stubs: 0,
    verdictsWritten: 0,
  };
  let page = 1;
  for (;;) {
    if (options.signal?.aborted) break;
    const data = await deps.discogs.getWantlistPage(options.username, page, perPage);
    progress.page = page;
    progress.pages = data.pagination.pages;
    deps.db.transaction(() => {
      for (const item of data.wants) {
        const result = applySeedItem(deps.db, {
          kind: "wantlist",
          releaseId: item.id,
          masterId: item.basic_information.master_id ?? null,
          dateAdded: item.date_added ?? null,
          rating: item.rating ?? null,
          notes: item.notes && item.notes !== "" ? item.notes : null,
          basicInformation: item.basic_information,
        });
        progress.processed += 1;
        if (result.stubCreated) progress.stubs += 1;
        if (result.verdictWritten) progress.verdictsWritten += 1;
      }
    })();
    onProgress?.({ ...progress });
    deps.logger.info(`wantlist page ${page}/${data.pagination.pages}: ${progress.processed} items`);
    if (page >= data.pagination.pages || data.wants.length === 0) break;
    page += 1;
  }
  return { kind: "wantlist", ...progress };
}
