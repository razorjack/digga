import { describe, expect, it } from "vite-plus/test";
import type { Api } from "../src/client/api.ts";
import { TwelvesShelf } from "../src/client/twelves/shelf.svelte.ts";
import {
  forgetMembership,
  recordMembership,
  recordMembershipOf,
} from "../src/server/db/memberships.ts";
import { upsertVerdict } from "../src/server/db/verdicts.ts";
import { queryTwelves } from "../src/server/queue/twelves.ts";
import type { VerdictInput } from "../src/shared/api.ts";
import { fixtureDb } from "./helpers.ts";

async function setup(releaseIds: number[], failedRemoval: number | null = null) {
  const db = await fixtureDb();
  const calls: string[] = [];
  const add = (releaseId: number) =>
    recordMembership(db, {
      kind: "wantlist",
      releaseId,
      masterId: 501,
      dateAdded: null,
      rating: null,
      notes: null,
    });
  for (const releaseId of releaseIds) add(releaseId);
  upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", releaseId: 1001 });
  const shelf = new TwelvesShelf({
    getTwelves: async () => ({ items: queryTwelves(db, null, null) }),
    getTrackMarks: async () => ({ items: [] }),
    postVerdict: async (input: VerdictInput) =>
      upsertVerdict(db, { ...input, source: input.source ?? "triage" }),
    removeFromWantlist: async (releaseId: number) => {
      calls.push(`remove ${releaseId}`);
      if (releaseId === failedRemoval) throw new Error("Discogs unavailable");
      forgetMembership(db, "wantlist", releaseId);
    },
    pushToWantlist: async (releaseId: number) => {
      calls.push(`add ${releaseId}`);
      add(releaseId);
    },
  } as unknown as Api);
  await shelf.load();
  return { db, shelf, calls };
}

describe("wanted pressings", () => {
  it("removes and restores the wanted pressing, even when the verdict names another", async () => {
    const { db, shelf, calls } = await setup([1002]);
    try {
      shelf.rejudge(shelf.items[0]!, "rejected");
      await shelf.changes;
      expect(recordMembershipOf(db, "m:501").wantlistReleaseIds).toEqual([]);
      expect(shelf.flash).toContain("Taken off your Discogs wantlist.");
      await shelf.undo();
      expect(recordMembershipOf(db, "m:501").wantlistReleaseIds).toEqual([1002]);
      expect(calls).toEqual(["remove 1002", "add 1002"]);
    } finally {
      shelf.destroy();
      db.close();
    }
  });

  it("undoes only successful removals when another pressing fails", async () => {
    const { db, shelf, calls } = await setup([1001, 1002], 1002);
    try {
      shelf.rejudge(shelf.items[0]!, "rejected");
      await shelf.changes;
      expect(shelf.flash).toContain("Still on your Discogs wantlist");
      expect(recordMembershipOf(db, "m:501").wantlistReleaseIds).toEqual([1002]);
      await shelf.undo();
      expect(
        recordMembershipOf(db, "m:501").wantlistReleaseIds.toSorted((left, right) => left - right),
      ).toEqual([1001, 1002]);
      expect(calls).toEqual(["remove 1001", "remove 1002", "add 1001"]);
    } finally {
      shelf.destroy();
      db.close();
    }
  });
});
