import type { ImportProgress } from "../../shared/types.ts";
import type { Db } from "../db/db.ts";
import type { DiscogsClient } from "../discogs/client.ts";
import type { Logger } from "../logger.ts";
import { applySeedItem } from "./seeds.ts";

export interface SeedImportDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

export interface SeedImportOptions {
  username: string;
  perPage?: number;
  signal?: AbortSignal;
}

export interface SeedImportResult extends ImportProgress {
  kind: "collection" | "wantlist";
}

export async function importCollection(
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
    const data = await deps.discogs.getCollectionPage(options.username, page, perPage);
    progress.page = page;
    progress.pages = data.pagination.pages;
    deps.db.transaction(() => {
      for (const item of data.releases) {
        const notes = item.notes?.map((n) => n.value).join("\n") ?? null;
        const result = applySeedItem(deps.db, {
          kind: "collection",
          releaseId: item.id,
          masterId: item.basic_information.master_id ?? null,
          dateAdded: item.date_added ?? null,
          rating: item.rating ?? null,
          notes: notes === "" ? null : notes,
          basicInformation: item.basic_information,
        });
        progress.processed += 1;
        if (result.stubCreated) progress.stubs += 1;
        if (result.verdictWritten) progress.verdictsWritten += 1;
      }
    })();
    onProgress?.({ ...progress });
    deps.logger.info(
      `collection page ${page}/${data.pagination.pages}: ${progress.processed} items`,
    );
    if (page >= data.pagination.pages || data.releases.length === 0) break;
    page += 1;
  }
  return { kind: "collection", ...progress };
}
