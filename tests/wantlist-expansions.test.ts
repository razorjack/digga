import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { previewAlternatives } from "../src/server/alternative-pressings.ts";
import { openDb, type Db } from "../src/server/db/db.ts";
import { forgetAccountData, recordMembershipOf } from "../src/server/db/memberships.ts";
import { createDiscogsClient } from "../src/server/discogs/client.ts";
import type { DiscogsRelease } from "../src/server/discogs/types.ts";
import {
  addAlternativeWants,
  undoAlternativeWants,
  type ExpansionDeps,
} from "../src/server/wantlist-expansions.ts";
import type { AddAlternativesInput } from "../src/shared/alternative-pressings.ts";

const options = { whiteLabels: true, promos: true, testPressings: false };
const release = (id: number, descriptions: string[] = [], title = "Tune"): DiscogsRelease => ({
  id,
  master_id: 50,
  title: "Record",
  artists: [{ id: 1, name: "Artist" }],
  formats: [{ name: "Vinyl", descriptions }],
  tracklist: [{ position: "A", title }],
});
let db: Db;
let deps: ExpansionDeps;
let releases: Map<number, DiscogsRelease>;
let wants: Map<number, string>;
let failedAdds: Set<number>;
let failedRemovals: Set<number>;
let writes: string[];
let reads: string[];

beforeEach(() => {
  db = openDb(":memory:");
  releases = new Map(
    [
      release(1),
      release(2, ["White Label"]),
      release(3, ["Promo"]),
      release(4, ["Promo"], "Tune (Remix)"),
      release(5, ["Test Pressing", "Promo"]),
      release(6, ["Promo"]),
    ].map((item) => [item.id, item]),
  );
  wants = new Map([
    [1, "Original note"],
    [2, "Manually added, not imported"],
  ]);
  failedAdds = new Set();
  failedRemovals = new Set();
  writes = [];
  reads = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const id = Number(url.pathname.split("/").at(-1));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (method === "GET") reads.push(url.pathname);
    if (url.pathname.startsWith("/releases/"))
      return releases.has(id) ? json(releases.get(id)) : json({}, 404);
    if (url.pathname === "/masters/50/versions") {
      const page = Number(url.searchParams.get("page"));
      return json({
        pagination: { pages: 2 },
        versions: (page === 1 ? [1, 2, 3] : [3, 4, 5, 6]).map((versionId) => ({
          id: versionId,
          format: '12", Promo',
        })),
      });
    }
    if (url.pathname === "/users/dj/wants")
      return json({
        pagination: { pages: 1 },
        wants: [...wants].map(([releaseId, notes]) => ({
          id: releaseId,
          notes,
          rating: 4,
          date_added: "2020-01-01",
          basic_information: releases.get(releaseId),
        })),
      });
    if (url.pathname.startsWith("/users/dj/wants/")) {
      writes.push(`${method} ${id}`);
      if (method === "PUT") {
        if (failedAdds.has(id)) return json({ message: "No addition" }, 403);
        wants.set(id, "");
        return json({}, 201);
      }
      if (failedRemovals.has(id)) return json({ message: "No removal" }, 403);
      wants.delete(id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  };
  deps = {
    db,
    username: "dj",
    currency: "EUR",
    discogs: createDiscogsClient({ token: "e2e-token-dj", fetchImpl, minIntervalMs: 0 }),
  };
});
afterEach(() => db.close());
const addOne = async (input: AddAlternativesInput) =>
  (await addAlternativeWants(deps, [input]))[0]!;
const addition = (releaseIds = [2, 3]): AddAlternativesInput => ({
  operationId: crypto.randomUUID(),
  releaseId: 1,
  releaseIds,
  options,
  automatic: false,
});

describe("wantlist expansion", () => {
  it("discovers across all master pages, deduplicates versions, and separates matching tracks from review", async () => {
    const result = await previewAlternatives(deps, { releaseId: 1, options });
    expect(result.candidates.map((candidate) => [candidate.release.id, candidate.match])).toEqual([
      [2, "matching"],
      [3, "matching"],
      [4, "review"],
      [6, "matching"],
    ]);
    expect(writes).toEqual([]);
  });
  it("preserves live manual wants and notes, records only additions, and undoes only those additions", async () => {
    const input = addition();
    const result = await addOne(input);
    expect(result).toMatchObject({ added: [3], existing: [2], errors: [] });
    expect(wants.get(2)).toBe("Manually added, not imported");
    expect(recordMembershipOf(db, "m:50").wantlistReleaseIds).toEqual([2, 3]);
    expect(await addOne(input)).toEqual(result);
    expect(writes).toEqual(["PUT 3"]);
    const undone = await undoAlternativeWants(deps, input.operationId);
    expect(undone.undone).toBe(true);
    expect([...wants.keys()]).toEqual([1, 2]);
    expect(writes).toEqual(["PUT 3", "DELETE 3"]);
  });
  it("reports partial failure, retries only unfinished additions, and retains failed undo entries", async () => {
    const input = addition([3, 6]);
    failedAdds.add(6);
    const result = await addOne(input);
    expect(result.added).toEqual([3]);
    expect(result.errors[0]?.releaseId).toBe(6);
    failedAdds.clear();
    expect((await addOne(input)).added).toEqual([3, 6]);
    expect(writes.filter((write) => write === "PUT 3")).toHaveLength(1);
    failedRemovals.add(6);
    expect(await undoAlternativeWants(deps, input.operationId)).toMatchObject({
      added: [6],
      undone: false,
    });
    failedRemovals.clear();
    expect((await undoAlternativeWants(deps, input.operationId)).undone).toBe(true);
    expect(writes.filter((write) => write === "DELETE 3")).toHaveLength(1);
  });
  it("revalidates automatic matches and permits an explicitly reviewed different tracklist", async () => {
    const automatic = { ...addition([4]), automatic: true };
    expect((await addOne(automatic)).errors[0]?.error).toContain("manual review");
    expect(writes).toEqual([]);
    expect((await addOne(addition([4]))).added).toEqual([4]);
  });
  it("rejects another master, nonselected formats, reused operation IDs, and an account change", async () => {
    releases.set(6, { ...releases.get(6)!, master_id: 99 });
    const input = addition([5, 6]);
    expect((await addOne(input)).errors).toHaveLength(2);
    expect(writes).toEqual([]);
    await expect(addOne({ ...input, releaseIds: [3] })).rejects.toThrow("another selection");
    forgetAccountData(db);
    await expect(undoAlternativeWants(deps, input.operationId)).rejects.toThrow("account changed");
  });
  it("reads the wantlist once per batch and skips the records an earlier try finished", async () => {
    const first = addition([2]);
    const second = addition([3, 6]);
    failedAdds.add(6);
    const results = await addAlternativeWants(deps, [first, second]);
    expect(results.map((result) => [result.added, result.existing])).toEqual([
      [[], [2]],
      [[3], []],
    ]);
    expect(reads.filter((path) => path === "/users/dj/wants")).toHaveLength(1);
    failedAdds.clear();
    reads = [];
    const retried = await addAlternativeWants(deps, [first, second]);
    expect(retried.map((result) => result.added)).toEqual([[], [3, 6]]);
    expect(reads).toEqual(["/users/dj/wants", "/releases/1", "/releases/6"]);
    reads = [];
    await addAlternativeWants(deps, [first, second]);
    expect(reads).toEqual([]);
  });
});
