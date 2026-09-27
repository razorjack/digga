import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createHttpApi } from "../src/client/api.ts";
import { createSandboxApi } from "../src/client/sandbox.ts";
import type { Db } from "../src/server/db/db.ts";
import { getVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { DiscogsListResponse, DiscogsListsResponse } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { Job } from "../src/shared/types.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

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
let apiUrl: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-lists-"));
  db = await fixtureDb();
  const paths = resolvePaths({ baseDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: { ...DEFAULT_CONFIG, discogs: { username: "dj", currency: "EUR", maybeListId: 77 } },
    paths,
    secrets: { getDiscogsToken: () => "token" },
    logger: silentLogger,
    db,
    serveStatic: false,
    fetchImpl: fakeFetch,
  });
  apiUrl = `${(await server.start(0)).url}/api`;
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

  it("reads a list as triage keys without writing", async () => {
    const res = await server.app.request("/api/discogs/lists/77");
    const body = (await res.json()) as DiscogsListResponse;
    expect(body.entries.map((e) => [e.key, e.release?.id, e.comment])).toEqual([
      ["m:501", 1001, null],
      ["m:506", 1006, "check the flip"],
    ]);
    expect(getVerdict(db, "m:506")).toBeNull();
  });

  it("answers 502 when Discogs refuses", async () => {
    const res = await server.app.request("/api/discogs/lists/404");
    expect(res.status).toBe(502);
  });

  it("imports the configured list as maybe seeds", async () => {
    const started = await server.app.request("/api/jobs/import/list", { method: "POST" });
    expect(started.status).toBe(202);
    const job = await waitForJob(((await started.json()) as Job).id);
    expect(job).toMatchObject({ type: "import_list", status: "done" });
    expect(getVerdict(db, "m:506")).toMatchObject({ status: "maybe", source: "seed:list" });
  });

  it("applies the list in memory in the sandbox", async () => {
    const sandbox = createSandboxApi(createHttpApi(apiUrl));
    const before = (await sandbox.getStats()).remaining;
    const job = await sandbox.startImport("list");
    let done = job;
    for (let i = 0; i < 200 && done.status === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      done = await sandbox.getJob(job.id);
    }
    expect(done).toMatchObject({ status: "done", progress: { processed: 2, verdictsWritten: 2 } });
    const maybes = await sandbox.getTwelves({ status: ["maybe"] });
    expect(maybes.items.map((i) => `${i.verdict.key} ${i.verdict.source}`).sort()).toEqual([
      "m:501 seed:list",
      "m:506 seed:list",
    ]);
    const stats = await sandbox.getStats();
    expect(stats.remaining).toBe(before - 2);
    expect(stats.dug).toBe(0);
    expect(getVerdict(db, "m:506")).toBeNull();
  });
});
