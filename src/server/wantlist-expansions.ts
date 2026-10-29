import {
  eligibleAlternative,
  matchingPressing,
  type AddAlternativesInput,
  type AlternativeAdditions,
  type AlternativePressing,
} from "../shared/alternative-pressings.ts";
import { messageOf, pressingFromApi, type AlternativesDeps } from "./alternative-pressings.ts";
import { accountDataVersion, assertAccountDataVersion } from "./db/memberships.ts";
import { getRelease, insertStubRelease } from "./db/releases.ts";
import { expansionReceipt, readExpansion, saveExpansion } from "./db/wantlist-expansions.ts";
import type { DiscogsWantItem } from "./discogs/types.ts";
import {
  applySeedItem,
  basicInformationToWrite,
  forgetWantlistItem,
  masterIdOf,
  recordWantlistPush,
} from "./importers/seeds.ts";

export interface ExpansionDeps extends AlternativesDeps {
  username: string;
}

export async function addAlternativeWants(
  deps: ExpansionDeps,
  input: AddAlternativesInput,
): Promise<AlternativeAdditions> {
  const receipt = expansionReceipt(deps.db, input);
  if (receipt.undone) throw new Error("This addition was undone; preview the alternatives again");
  const version = accountDataVersion(deps.db);
  receipt.errors = [];
  try {
    const wanted = await readCurrentWants(deps);
    const source = pressingFromApi(await deps.discogs.getRelease(input.releaseId, deps.currency));
    for (const releaseId of new Set(input.releaseIds)) {
      assertAccountDataVersion(deps.db, version);
      if (receipt.added.includes(releaseId) || receipt.existing.includes(releaseId)) continue;
      await addOneAlternative(deps, { input, source, releaseId, wanted, version }, receipt);
    }
  } catch (error) {
    receipt.errors.push({ releaseId: input.releaseId, error: messageOf(error) });
  }
  assertAccountDataVersion(deps.db, version);
  saveExpansion(deps.db, receipt);
  return receipt;
}

interface Addition {
  input: AddAlternativesInput;
  source: AlternativePressing;
  releaseId: number;
  wanted: Map<number, DiscogsWantItem>;
  version: number;
}

async function addOneAlternative(
  deps: ExpansionDeps,
  addition: Addition,
  receipt: AlternativeAdditions,
): Promise<void> {
  const { releaseId, input, source, wanted, version } = addition;
  try {
    const existing = wanted.get(releaseId);
    if (existing) {
      rememberExistingWant(deps, existing);
      receipt.existing.push(releaseId);
    } else {
      const release = await deps.discogs.getRelease(releaseId, deps.currency);
      const candidate = pressingFromApi(release);
      assertEligible(source, candidate, input);
      assertAccountDataVersion(deps.db, version);
      await deps.discogs.addToWantlist(deps.username, releaseId);
      assertAccountDataVersion(deps.db, version);
      deps.db.transaction(() => {
        insertStubRelease(deps.db, basicInformationToWrite(release));
        recordWantlistPush(deps.db, getRelease(deps.db, releaseId)!, null);
        receipt.added.push(releaseId);
        saveExpansion(deps.db, receipt);
      })();
    }
  } catch (error) {
    receipt.errors.push({ releaseId, error: messageOf(error) });
  }
}

function assertEligible(
  source: AlternativePressing,
  candidate: AlternativePressing,
  input: AddAlternativesInput,
): void {
  if (
    candidate.id === source.id ||
    source.masterId === null ||
    source.masterId !== candidate.masterId
  )
    throw new Error("This release is not another pressing of the same master");
  if (!eligibleAlternative(candidate.formats, input.options))
    throw new Error("This pressing no longer matches the selected formats");
  if (input.automatic && !matchingPressing(source, candidate))
    throw new Error("The tracklist needs manual review in Twelves");
}

async function readCurrentWants(deps: ExpansionDeps): Promise<Map<number, DiscogsWantItem>> {
  const wanted = new Map<number, DiscogsWantItem>();
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const result = await deps.discogs.getWantlistPage(deps.username, page, 100);
    pages = result.pagination.pages;
    if (result.wants.length === 0 && page < pages)
      throw new Error("Discogs returned an incomplete wantlist");
    for (const item of result.wants) wanted.set(item.id, item);
  }
  return wanted;
}

function rememberExistingWant(deps: ExpansionDeps, item: DiscogsWantItem): void {
  applySeedItem(deps.db, {
    kind: "wantlist",
    releaseId: item.id,
    masterId: masterIdOf(item.basic_information),
    dateAdded: item.date_added,
    rating: item.rating ?? null,
    notes: item.notes ?? null,
    basicInformation: item.basic_information,
  });
}

export async function undoAlternativeWants(
  deps: ExpansionDeps,
  operationId: string,
): Promise<AlternativeAdditions> {
  const saved = readExpansion(deps.db, operationId);
  if (!saved) throw new Error("The addition could not be found");
  const receipt = saved.result;
  const version = accountDataVersion(deps.db);
  receipt.errors = [];
  for (const releaseId of receipt.added) {
    try {
      assertAccountDataVersion(deps.db, version);
      await deps.discogs.removeFromWantlist(deps.username, releaseId);
      assertAccountDataVersion(deps.db, version);
      deps.db.transaction(() => {
        forgetWantlistItem(deps.db, releaseId);
        receipt.added = receipt.added.filter((id) => id !== releaseId);
        saveExpansion(deps.db, receipt);
      })();
    } catch (error) {
      receipt.errors.push({ releaseId, error: messageOf(error) });
    }
  }
  assertAccountDataVersion(deps.db, version);
  receipt.undone = receipt.added.length === 0;
  saveExpansion(deps.db, receipt);
  return receipt;
}
