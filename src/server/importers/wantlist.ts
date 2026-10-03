import type { ImportProgress } from "../../shared/types.ts";
import type { DiscogsWantItem } from "../discogs/types.ts";
import {
  importSeedPages,
  type SeedImportDeps,
  type SeedImportOptions,
  type SeedImportResult,
  type SeedItemInput,
} from "./seeds.ts";

/** Reads the account's wantlist into memberships. */
export async function importWantlist(
  deps: SeedImportDeps,
  options: SeedImportOptions,
  onProgress?: (p: ImportProgress) => void,
): Promise<SeedImportResult> {
  if (options.username === "") throw new Error("discogs.username is not set in digga.config.json");
  const perPage = options.perPage ?? 100;
  const readPage = async (page: number) => {
    const data = await deps.discogs.getWantlistPage(options.username, page, perPage);
    return { pages: data.pagination.pages, items: data.wants.map(wantlistItem) };
  };
  return importSeedPages(deps, { kind: "wantlist", readPage, signal: options.signal }, onProgress);
}

function wantlistItem(item: DiscogsWantItem): SeedItemInput {
  return {
    kind: "wantlist",
    releaseId: item.id,
    masterId: item.basic_information.master_id ?? null,
    dateAdded: item.date_added ?? null,
    rating: item.rating ?? null,
    notes: item.notes && item.notes !== "" ? item.notes : null,
    basicInformation: item.basic_information,
  };
}
