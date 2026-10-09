import { masterKey, releaseKey } from "../../shared/triage-key.ts";
import type { ImportProgress } from "../../shared/types.ts";
import { type Db, nowIso } from "../db/db.ts";
import {
  accountDataVersion,
  assertAccountDataVersion,
  markMissingMemberships,
  recordMembership,
} from "../db/memberships.ts";
import { getRelease, insertStubRelease, type ReleaseWrite } from "../db/releases.ts";
import type { DiscogsClient } from "../discogs/client.ts";
import type { DiscogsListItem, DiscogsRelease } from "../discogs/types.ts";
import type { Logger } from "../logger.ts";
import { representativeForKey } from "../queue/query.ts";
import { basicInformationToWrite } from "./seeds.ts";

export interface ListImportDeps {
  db: Db;
  discogs: DiscogsClient;
  logger: Logger;
}

export interface ListImportOptions {
  listId: number;
  /** Currency for the release lookups; prices are not stored from here. */
  currency: string;
  signal?: AbortSignal;
}

export interface ListImportResult extends ImportProgress {
  kind: "list";
  listName: string;
}

/** A list entry mapped to Digga's triage key, with a stub row when the release is outside the dump. */
export interface ResolvedListEntry {
  type: "release" | "master";
  discogsId: number;
  key: string;
  displayTitle: string;
  comment: string | null;
  releaseId: number | null;
  stub: ReleaseWrite | null;
}

/** Stub row from a full API release, the same shape the collection and wantlist imports write. */
export function releaseToWrite(release: DiscogsRelease): ReleaseWrite {
  const write = basicInformationToWrite({
    id: release.id,
    master_id: release.master_id ?? null,
    title: release.title,
    year: release.year,
    artists: release.artists,
    labels: release.labels,
    formats: release.formats,
    genres: release.genres,
    styles: release.styles,
  });
  return { ...write, country: release.country && release.country !== "" ? release.country : null };
}

/**
 * Maps list items to triage keys. Releases and masters in the loaded dump need no request;
 * others are looked up (a master through its main release) so they get the right key and a stub.
 * Artists and labels on the list are ignored. Reads only: nothing is written here.
 */
export async function resolveListEntries(
  deps: { db: Db; discogs: DiscogsClient; logger: Logger },
  items: DiscogsListItem[],
  options: { currency: string; signal?: AbortSignal },
): Promise<ResolvedListEntry[]> {
  const entries: ResolvedListEntry[] = [];
  for (const item of items) {
    options.signal?.throwIfAborted();
    if (item.type !== "release" && item.type !== "master") continue;
    const base = {
      type: item.type,
      discogsId: item.id,
      displayTitle: item.display_title ?? "",
      comment: item.comment && item.comment.trim() !== "" ? item.comment.trim() : null,
    } as const;
    try {
      const resolved = await resolveListItem(deps, item, options.currency);
      entries.push({ ...base, ...resolved });
    } catch (err) {
      options.signal?.throwIfAborted();
      deps.logger.warn(
        `list item ${item.type} ${item.id} could not be looked up: ${err instanceof Error ? err.message : String(err)}`,
      );
      const key = item.type === "master" ? masterKey(item.id) : releaseKey(item.id);
      entries.push({
        ...base,
        key,
        releaseId: item.type === "release" ? item.id : null,
        stub: null,
      });
    }
  }
  return entries;
}

async function resolveListItem(
  deps: ListImportDeps,
  item: DiscogsListItem,
  currency: string,
): Promise<Pick<ResolvedListEntry, "key" | "releaseId" | "stub">> {
  if (item.type === "release") {
    const known = getRelease(deps.db, item.id);
    if (known) return { key: known.triageKey, releaseId: known.id, stub: null };
    const stub = releaseToWrite(await deps.discogs.getRelease(item.id, currency));
    return { key: stub.triageKey, releaseId: stub.id, stub };
  }
  const key = masterKey(item.id);
  const representative = representativeForKey(deps.db, key);
  if (representative) return { key, releaseId: representative.id, stub: null };
  const master = await deps.discogs.getMaster(item.id);
  const main = await deps.discogs.getRelease(master.main_release, currency);
  const stub = releaseToWrite({ ...main, master_id: item.id });
  return { key, releaseId: stub.id, stub };
}

/**
 * Records every release and master on the list as held on the Maybe list, which is how Digga
 * learns that a maybe was added on Discogs. A master is held through the release it resolved to.
 */
export async function importList(
  deps: ListImportDeps,
  options: ListImportOptions,
  onProgress?: (p: ImportProgress) => void,
): Promise<ListImportResult> {
  options.signal?.throwIfAborted();
  const accountVersion = accountDataVersion(deps.db);
  const list = await deps.discogs.getList(options.listId);
  const entries = await resolveListEntries(deps, list.items, options);
  options.signal?.throwIfAborted();
  assertAccountDataVersion(deps.db, accountVersion);
  const progress = applyListEntries(deps.db, entries);
  onProgress?.({ ...progress });
  deps.logger.info(`list "${list.name}": ${progress.processed} items, ${progress.added} new`);
  return { kind: "list", listName: list.name, ...progress };
}

/**
 * Holds every entry's record on the Maybe list, in one transaction. When every entry resolved to
 * a release, the list is complete, and the items it no longer has left it outside Digga.
 */
function applyListEntries(db: Db, entries: ResolvedListEntry[]): ImportProgress {
  const progress: ImportProgress = {
    page: 1,
    pages: 1,
    processed: 0,
    stubs: 0,
    added: 0,
    removed: 0,
  };
  const since = nowIso();
  db.transaction(() => {
    for (const entry of entries) {
      progress.processed += 1;
      if (entry.stub && insertStubRelease(db, entry.stub)) progress.stubs += 1;
      // A master the lookup could not resolve has no release to hold; the next import tries again.
      if (entry.releaseId === null) continue;
      const added = recordMembership(db, {
        kind: "list",
        releaseId: entry.releaseId,
        masterId: entry.type === "master" ? entry.discogsId : null,
        dateAdded: null,
        rating: null,
        notes: entry.comment,
      });
      if (added) progress.added += 1;
    }
    const releaseIds = entries.map((entry) => entry.releaseId).filter((id) => id !== null);
    if (releaseIds.length === entries.length)
      progress.removed = markMissingMemberships(db, "list", { releaseIds, since });
  })();
  return progress;
}
