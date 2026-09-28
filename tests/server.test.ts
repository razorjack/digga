import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Db, openDb } from "../src/server/db/db.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { QueueResponse, ReleaseDetail, Stats, TwelvesResponse } from "../src/shared/api.ts";
import type { Job, Verdict } from "../src/shared/types.ts";
import { FIXTURE_GZ, fixtureDb, silentLogger } from "./helpers.ts";

let tmp: string;
let db: Db;
let server: DiggaServer;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-server-"));
  db = await fixtureDb();
  const paths = resolvePaths({ baseDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: { ...DEFAULT_CONFIG, sandbox: false },
    paths,
    secrets: { getDiscogsToken: () => undefined },
    logger: silentLogger,
    db,
    serveStatic: true,
    persistConfig: true,
  });
});
afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = async <T>(url: string): Promise<{ status: number; body: T }> => {
  const res = await server.app.request(url);
  return { status: res.status, body: (await res.json()) as T };
};
const send = async <T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: T }> => {
  const res = await server.app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

async function waitForJob(id: string): Promise<Job> {
  for (let i = 0; i < 100; i += 1) {
    const { body } = await get<Job>(`/api/jobs/${id}`);
    if (body.status !== "running" && body.status !== "queued") return body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job did not finish");
}

describe("HTTP API", () => {
  it.each(["1001garbage", "1001.5", "0", "-1", "9007199254740992"])(
    "rejects malformed ID %s across release, list and wantlist routes",
    async (id) => {
      expect((await get(`/api/releases/${id}`)).status).toBe(400);
      expect((await get(`/api/discogs/lists/${id}`)).status).toBe(400);
      expect((await send("POST", `/api/discogs/wantlist/${id}`, {})).status).toBe(400);
      expect((await send("DELETE", `/api/discogs/wantlist/${id}`)).status).toBe(400);
    },
  );

  it("serves the queue with config defaults and query overrides", async () => {
    const q = await get<QueueResponse>("/api/queue");
    expect(q.status).toBe(200);
    expect(q.body.items.map((i) => i.id)).toEqual([1006, 1001]);
    expect(q.body).toMatchObject({ remaining: 2, strategy: "label_sweep", seed: null });
    const limited = await get<QueueResponse>("/api/queue?limit=1&strategy=random&seed=5");
    expect(limited.body.items).toHaveLength(1);
    expect(limited.body.seed).toBe(5);
    expect((await get<QueueResponse>("/api/queue?offset=1")).body.items.map((i) => i.id)).toEqual([
      1001,
    ]);
    expect((await get("/api/queue?strategy=bogus")).status).toBe(400);
    expect((await get("/api/queue?offset=-1")).status).toBe(400);
  });

  it("previews unsaved filters on the queue and stats", async () => {
    const open = JSON.stringify({ yearFrom: null, yearTo: null, formats: [] });
    const q = await get<QueueResponse>(`/api/queue?filters=${encodeURIComponent(open)}`);
    expect(q.body.items.map((i) => i.id)).toEqual([1004, 1006, 1001]);
    expect(q.body.filters).toMatchObject({
      yearFrom: null,
      formats: [],
      includeUnknownYear: false,
    });
    const stats = await get<Stats>(`/api/stats?filters=${encodeURIComponent(open)}`);
    expect(stats.body.universe.filteredKeys).toBe(3);
    expect(stats.body.remaining).toBe(3);
    expect((await get<QueueResponse>("/api/queue")).body.remaining).toBe(2);
    expect((await get("/api/queue?filters=nope")).status).toBe(400);
    expect((await get(`/api/stats?filters=${encodeURIComponent('{"yearFrom":"x"}')}`)).status).toBe(
      400,
    );
  });

  it("returns the full release record", async () => {
    const r = await get<ReleaseDetail>("/api/releases/1001");
    expect(r.status).toBe(200);
    expect(r.body.release.artistDisplay).toBe("Ed Rush & Optical");
    expect(r.body.tracks.map((t) => [t.position, t.hasVideo, t.heard])).toEqual([
      ["A1", true, false],
      ["A2", false, false],
      ["B1", true, false],
    ]);
    expect(r.body.videos).toHaveLength(2);
    expect(r.body.verdict).toBeNull();
    expect(r.body.siblings.map((s) => s.id)).toEqual([1002]);
    expect((await get("/api/releases/4242")).status).toBe(404);
    expect((await get("/api/releases/abc")).status).toBe(400);
  });

  it("writes, lists and undoes verdicts and track verdicts", async () => {
    const v = await send<Verdict>("POST", "/api/verdicts", {
      key: "m:501",
      status: "accepted",
      releaseId: 1001,
      notes: "wheel up",
    });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({
      key: "m:501",
      status: "accepted",
      source: "triage",
      notes: "wheel up",
    });
    expect((await get<QueueResponse>("/api/queue")).body.items.map((i) => i.id)).toEqual([1006]);
    expect((await send("POST", "/api/verdicts", { key: "nope", status: "accepted" })).status).toBe(
      400,
    );
    const tv = await send<{ mark: string }>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      mark: "keep",
    });
    expect(tv.body.mark).toBe("keep");
    const detail = await get<ReleaseDetail>("/api/releases/1001");
    expect(detail.body.tracks[2]!.mark).toBe("keep");
    expect(detail.body.verdict!.status).toBe("accepted");
    const twelves = await get<TwelvesResponse>("/api/twelves?status=accepted");
    expect(twelves.body.items).toHaveLength(1);
    expect(twelves.body.items[0]!.release!.id).toBe(1001);
    const undo = await send<{ deleted: boolean }>("DELETE", "/api/verdicts/m:501");
    expect(undo.body.deleted).toBe(true);
    expect((await get<QueueResponse>("/api/queue")).body.remaining).toBe(2);
  });

  it("logs listens and marks tracks heard everywhere the tune appears", async () => {
    const log = await send<{ id: number; heardKey: string | null }>("POST", "/api/listen-log", {
      releaseId: 1006,
      position: "A",
      videoId: "dddddddddd1",
      seconds: 12,
    });
    expect(log.body.heardKey).toBe("konflikt - messiah");
    await send("POST", "/api/listen-log", {
      releaseId: 1003,
      position: "A",
      videoId: "bbbbbbbbbb1",
      seconds: 4,
    });
    const sampler = await get<ReleaseDetail>("/api/releases/1003");
    expect(sampler.body.tracks[0]!.heard).toBe(true);
    const stats = await get<Stats>("/api/stats");
    expect(stats.body.heardTracks).toBe(2);
    expect(stats.body.universe).toEqual({ releases: 5, keys: 4, filteredKeys: 2 });
    expect(stats.body.remaining).toBe(2);
  });

  it("reads and rewrites settings, changing the queue without a reload", async () => {
    const before = await get<typeof DEFAULT_CONFIG>("/api/settings");
    expect(before.body.filters.yearFrom).toBe(1998);
    const next = {
      ...DEFAULT_CONFIG,
      filters: {
        ...DEFAULT_CONFIG.filters,
        yearFrom: null,
        yearTo: null,
        formats: [],
        includeUnknownYear: true,
      },
    };
    const put = await send<typeof DEFAULT_CONFIG>("PUT", "/api/settings", next);
    expect(put.status).toBe(200);
    expect(put.body.filters.yearTo).toBeNull();
    expect((await get<QueueResponse>("/api/queue")).body.items.map((i) => i.id)).toEqual([
      1004, 1006, 1001, 1003,
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(tmp, "digga.config.json"), "utf8")).filters.formats,
    ).toEqual([]);
    expect((await send("PUT", "/api/settings", { server: { port: -1 } })).status).toBe(400);
  });

  it("preserves active settings and sandbox protection when saving fails", async () => {
    await send("PUT", "/api/settings", DEFAULT_CONFIG);
    const configFile = path.join(tmp, "digga.config.json");
    fs.rmSync(configFile);
    fs.mkdirSync(configFile);

    const response = await send("PUT", "/api/settings", {
      ...DEFAULT_CONFIG,
      sandbox: false,
      discogs: { ...DEFAULT_CONFIG.discogs, username: "changed" },
    });

    expect(response.status).toBe(500);
    expect(server.getConfig()).toEqual(DEFAULT_CONFIG);
    expect((await get("/api/settings")).body).toEqual(DEFAULT_CONFIG);
    expect(
      (
        await send("POST", "/api/verdicts", {
          key: "m:501",
          status: "accepted",
          releaseId: 1001,
        })
      ).status,
    ).toBe(409);
  });

  it("runs jobs and reports them", async () => {
    const started = await send<Job>("POST", "/api/jobs/dump-load", {
      file: FIXTURE_GZ,
      dryRun: true,
    });
    expect(started.status).toBe(202);
    const done = await waitForJob(started.body.id);
    expect(done.status).toBe("done");
    expect(done.progress).toMatchObject({ scanned: 6, matched: 5 });
    const list = await get<{ jobs: Job[] }>("/api/jobs");
    expect(list.body.jobs[0]!.id).toBe(started.body.id);
    expect((await send("POST", "/api/jobs/dump-load", { file: "/nope.xml.gz" })).status).toBe(400);
    expect((await send("POST", "/api/jobs/import/bogus", {})).status).toBe(400);
    const imp = await send<Job>("POST", "/api/jobs/import/history", {
      path: "/definitely/missing/History",
    });
    expect(imp.status).toBe(202);
    expect((await waitForJob(imp.body.id)).status).toBe("failed");
    expect((await get("/api/jobs/missing")).status).toBe(404);
  });

  it("enriches the Twelves records as a job of its own", async () => {
    const started = await send<Job>("POST", "/api/jobs/enrich", { target: "twelves", ahead: null });
    expect(started.status).toBe(202);
    expect(started.body.type).toBe("enrich_twelves");
    const done = await waitForJob(started.body.id);
    expect(done).toMatchObject({ status: "done", progress: { done: 0, total: 0 } });
    expect((await send("POST", "/api/jobs/enrich", { target: "shelf" })).status).toBe(400);
    expect((await get<Stats>("/api/stats")).body.remainingEnriched).toBe(0);
  });

  it("404s unknown routes", async () => {
    expect((await get("/api/nothing")).status).toBe(404);
  });

  it("serves dist/ for non-API paths", async () => {
    fs.mkdirSync(path.join(tmp, "dist", "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<h1>digga</h1>");
    fs.writeFileSync(path.join(tmp, "dist", "assets", "app.js"), "console.log(1)");
    const index = await server.app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toBe("<h1>digga</h1>");
    const js = await server.app.request("/assets/app.js");
    expect(js.headers.get("cache-control")).toContain("immutable");
    const fallback = await server.app.request("/anything/else");
    expect(await fallback.text()).toBe("<h1>digga</h1>");
    const escape = await server.app.request("/../package.json");
    expect(await escape.text()).toBe("<h1>digga</h1>");
  });

  it("starts on a free port bound to localhost and stops", async () => {
    const info = await server.start(0);
    expect(info.port).toBeGreaterThan(0);
    expect(info.host).toBe("127.0.0.1");
    expect(info.browserUrl).toBe(`http://localhost:${info.port}`);
    const res = await fetch(`${info.url}/api/health`);
    expect(await res.json()).toEqual({ ok: true, name: "digga" });
  });
});

describe("createServer with its own database file", () => {
  it("opens paths.dbFile and applies migrations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-own-"));
    const paths = resolvePaths({ baseDir: dir });
    const own = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: { getDiscogsToken: () => undefined },
      logger: silentLogger,
      serveStatic: false,
    });
    const res = await own.app.request("/api/stats");
    expect(res.status).toBe(200);
    await own.stop();
    const check = openDb(paths.dbFile, { readonly: true });
    expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({
      value: "1",
    });
    check.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
