import type { DiscogsListEntry, QueueItem } from "../../shared/api.ts";
import { formatSummary } from "../../shared/formats.ts";
import { masterKey, releaseKey } from "../../shared/triage-key.ts";
import type { ImportProgress } from "../../shared/types.ts";
import { type Db, nowIso } from "../db/db.ts";
import { getRelease, insertStubRelease, type ReleaseWrite } from "../db/releases.ts";
import { applySeedVerdict, getVerdict } from "../db/verdicts.ts";
import type { DiscogsClient } from "../discogs/client.ts";
import type { DiscogsListItem, DiscogsRelease } from "../discogs/types.ts";
import type { Logger } from "../logger.ts";
import { queueItemForRelease, representativeForKey } from "../queue/query.ts";
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
export function releaseToWrite(rel: DiscogsRelease): ReleaseWrite {
  const write = basicInformationToWrite({
    id: rel.id,
    master_id: rel.master_id ?? null,
    title: rel.title,
    year: rel.year,
    artists: rel.artists,
    labels: rel.labels,
    formats: rel.formats,
    genres: rel.genres,
    styles: rel.styles,
  });
  return { ...write, country: rel.country && rel.country !== "" ? rel.country : null };
}

export function queueItemFromWrite(w: ReleaseWrite): QueueItem {
  return {
    id: w.id,
    triageKey: w.triageKey,
    masterId: w.masterId,
    title: w.title,
    artistDisplay: w.artistDisplay,
    labelName: w.labelName,
    catno: w.catno,
    year: w.year,
    country: w.country,
    formatSummary: formatSummary(w.formats),
    styles: w.styles,
    videoCount: 0,
    communityWant: null,
    communityHave: null,
    numForSale: null,
    lowestPrice: null,
    currency: null,
    enrichedAt: null,
  };
}

/**
 * Maps list items to triage keys. Releases and masters in the loaded dump need no request;
 * others are looked up (a master through its main release) so they get the right key and a stub.
 * Artists and labels on the list are ignored. Reads only: nothing is written here.
 */
export async function resolveListEntries(
  deps: { db: Db; discogs: DiscogsClient; logger: Logger },
  items: DiscogsListItem[],
  opts: { currency: string; signal?: AbortSignal },
): Promise<ResolvedListEntry[]> {
  const out: ResolvedListEntry[] = [];
  for (const item of items) {
    if (opts.signal?.aborted) break;
    if (item.type !== "release" && item.type !== "master") continue;
    const base = {
      type: item.type,
      discogsId: item.id,
      displayTitle: item.display_title ?? "",
      comment: item.comment && item.comment.trim() !== "" ? item.comment.trim() : null,
    } as const;
    try {
      if (item.type === "release") {
        const known = getRelease(deps.db, item.id);
        if (known) {
          out.push({ ...base, key: known.triageKey, releaseId: known.id, stub: null });
          continue;
        }
        const stub = releaseToWrite(await deps.discogs.getRelease(item.id, opts.currency));
        out.push({ ...base, key: stub.triageKey, releaseId: stub.id, stub });
        continue;
      }
      const key = masterKey(item.id);
      const representative = representativeForKey(deps.db, key);
      if (representative) {
        out.push({ ...base, key, releaseId: representative.id, stub: null });
        continue;
      }
      const master = await deps.discogs.getMaster(item.id);
      const main = await deps.discogs.getRelease(master.main_release, opts.currency);
      const stub = releaseToWrite({ ...main, master_id: item.id });
      out.push({ ...base, key, releaseId: stub.id, stub });
    } catch (err) {
      deps.logger.warn(
        `list item ${item.type} ${item.id} could not be looked up: ${err instanceof Error ? err.message : String(err)}`,
      );
      const key = item.type === "master" ? masterKey(item.id) : releaseKey(item.id);
      out.push({ ...base, key, releaseId: item.type === "release" ? item.id : null, stub: null });
    }
  }
  return out;
}

/** The read-only view of a list: entries with the release to show and the current verdict. */
export function listEntriesForApi(db: Db, entries: ResolvedListEntry[]): DiscogsListEntry[] {
  return entries.map((e) => ({
    type: e.type,
    discogsId: e.discogsId,
    key: e.key,
    displayTitle: e.displayTitle,
    comment: e.comment,
    release: e.stub
      ? queueItemFromWrite(e.stub)
      : e.releaseId !== null
        ? queueItemForRelease(db, e.releaseId)
        : null,
    verdict: getVerdict(db, e.key),
  }));
}

/**
 * Marks every release and master on the list as `maybe` (source `seed:list`). A want or grail
 * from triage, the wantlist and the collection outrank the list; a `maybe` from triage becomes a
 * list seed, which is how Digga learns that a maybe was added on Discogs.
 */
export async function importList(
  deps: ListImportDeps,
  opts: ListImportOptions,
  onProgress?: (p: ImportProgress) => void,
): Promise<ListImportResult> {
  const list = await deps.discogs.getList(opts.listId);
  const entries = await resolveListEntries(deps, list.items, opts);
  const progress: ImportProgress = {
    page: 1,
    pages: 1,
    processed: 0,
    stubs: 0,
    verdictsWritten: 0,
  };
  deps.db.transaction(() => {
    for (const e of entries) {
      progress.processed += 1;
      if (e.stub && insertStubRelease(deps.db, e.stub)) progress.stubs += 1;
      const previous = getVerdict(deps.db, e.key);
      if (previous?.status === "maybe" && previous.source === "seed:list") continue;
      const { written } = applySeedVerdict(deps.db, {
        key: e.key,
        status: "maybe",
        source: "seed:list",
        notes: e.comment ?? previous?.notes ?? null,
        releaseId: e.releaseId,
        decidedAt: nowIso(),
      });
      if (written) progress.verdictsWritten += 1;
    }
  })();
  onProgress?.({ ...progress });
  deps.logger.info(
    `list "${list.name}": ${progress.processed} items, ${progress.verdictsWritten} verdicts written`,
  );
  return { kind: "list", listName: list.name, ...progress };
}
