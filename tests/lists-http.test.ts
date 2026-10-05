import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { recordMembershipOf } from "../src/server/db/memberships.ts";
import { getVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { DiscogsListsResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { Job } from "../src/shared/types.ts";
import { fixtureDb, silentLogger, testSecrets } from "./helpers.ts";

const DISCOGS: Record<string, unknown> = {
  "/users/dj/lists": {
    pagination: { page: 1, pages: 1, per_page: 100, items: 2 },
    lists: [
      { id: 77, name: "Maybe", public: false },
      { id: 78, name: "Best of 1999", public: true },
    ],
  },
  "/lists/77": {
    id: 77,
    name: "Maybe",
    items: [
      { id: 1001, type: "release", display_title: "Ed Rush & Optical - Wormhole" },
      { id: 506, type: "master", display_title: "Konflict - Messiah", comment: "check the flip" },
      { id: 3, type: "artist", display_title: "Somebody" },
    ],
  },
};

const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = DISCOGS[url.pathname];
  return body === undefined
    ? new Response(JSON.stringify({ message: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
};

let tmp: string;
let db: Db;
let server: DiggaServer;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-lists-"));
  db = await fixtureDb();
  const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: {
      ...DEFAULT_CONFIG,
      discogs: { ...DEFAULT_CONFIG.discogs, username: "dj", maybeListId: 77 },
    },
    paths,
    secrets: testSecrets(() => "token"),
    logger: silentLogger,
    db,
    serveStatic: false,
    fetchImpl: fakeFetch,
  });
  await server.start(0);
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function waitForJob(id: string): Promise<Job> {
  for (let i = 0; i < 200; i += 1) {
    const job = (await (await server.app.request(`/api/jobs/${id}`)).json()) as Job;
    if (job.status !== "running" && job.status !== "queued") return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job did not finish");
}

describe("Discogs lists over HTTP", () => {
  it("lists the user's lists, private ones included", async () => {
    const res = await server.app.request("/api/discogs/lists");
    expect(((await res.json()) as DiscogsListsResponse).lists).toEqual([
      { id: 77, name: "Maybe", public: false },
      { id: 78, name: "Best of 1999", public: true },
    ]);
  });

  it("holds the configured list's records on the Maybe list", async () => {
    const started = await server.app.request("/api/jobs/import/list", { method: "POST" });
    expect(started.status).toBe(202);
    const job = await waitForJob(((await started.json()) as Job).id);
    expect(job).toMatchObject({ type: "import_list", status: "done" });
    expect(recordMembershipOf(db, "m:506").onList).toBe(true);
    expect(getVerdict(db, "m:506")).toBeNull();
  });
});
