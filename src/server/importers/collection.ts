import type { ImportProgress } from "../../shared/types.ts";
import type { DiscogsCollectionItem } from "../discogs/types.ts";
import {
  importSeedPages,
  type SeedImportDeps,
  type SeedImportOptions,
  type SeedImportResult,
  type SeedItemInput,
} from "./seeds.ts";

/** Reads the account's collection, newest first, into memberships. */
export async function importCollection(
  deps: SeedImportDeps,
  options: SeedImportOptions,
  onProgress?: (p: ImportProgress) => void,
): Promise<SeedImportResult> {
  const perPage = options.perPage ?? 100;
  const readPage = async (page: number) => {
    const data = await deps.discogs.getCollectionPage(options.username, page, perPage);
    return { pages: data.pagination.pages, items: data.releases.map(collectionItem) };
  };
  return importSeedPages(
    deps,
    { kind: "collection", username: options.username, readPage, signal: options.signal },
    onProgress,
  );
}

function collectionItem(item: DiscogsCollectionItem): SeedItemInput {
  const notes = item.notes?.map((note) => note.value).join("\n") ?? "";
  return {
    kind: "collection",
    releaseId: item.id,
    masterId: item.basic_information.master_id ?? null,
    dateAdded: item.date_added ?? null,
    rating: item.rating ?? null,
    notes: notes === "" ? null : notes,
    basicInformation: item.basic_information,
  };
}
