import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Db, listMigrations, openDb } from "../src/server/db/db.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import {
  expectedVerdict,
  type QueueResponse,
  type ReleaseDetail,
  type ScopeSearchResponse,
  type Stats,
  type TrackMarksResponse,
  type TwelvesResponse,
} from "../src/shared/api.ts";
import type { Job, TrackVerdict, Verdict } from "../src/shared/types.ts";
import { FIXTURE_GZ, fixtureDb, silentLogger, testSecrets, tuneAt } from "./helpers.ts";

let tmp: string;
let db: Db;
let server: DiggaServer;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-server-"));
  db = await fixtureDb();
  const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: testSecrets(),
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

/** The undo of a verdict: deletes it while it is still the one saved. */
const undoUrl = (verdict: Verdict) =>
  `/api/verdicts/${verdict.key}?${new URLSearchParams(expectedVerdict(verdict)).toString()}`;

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
    "rejects malformed ID %s across release and wantlist routes",
    async (id) => {
      expect((await get(`/api/releases/${id}`)).status).toBe(400);
      expect((await send("POST", `/api/discogs/wantlist/${id}`, {})).status).toBe(400);
      expect((await send("DELETE", `/api/discogs/wantlist/${id}`)).status).toBe(400);
    },
  );

  it("saves a release note without a verdict and keeps it after undo", async () => {
    expect(
      (await send("PUT", "/api/releases/1001/note", { notes: "hear the B side again" })).status,
    ).toBe(200);
    let detail = (await get<ReleaseDetail>("/api/releases/1001")).body;
    expect(detail.note).toBe("hear the B side again");
    expect(detail.verdict).toBeNull();
    // 1002 is the other pressing of master 501: it shows the note with the pressing it is on.
    expect((await get<ReleaseDetail>("/api/releases/1002")).body.pressingNotes).toEqual([
      { releaseId: 1001, catno: "RH 20", notes: "hear the B side again" },
    ]);
    const snooze = await send<Verdict>("POST", "/api/verdicts", {
      key: "m:501",
      releaseId: 1001,
      status: "snoozed",
    });
    await send("DELETE", undoUrl(snooze.body));
    detail = (await get<ReleaseDetail>("/api/releases/1001")).body;
    expect(detail.verdict).toBeNull();
    expect(detail.note).toBe("hear the B side again");
    await send("PUT", "/api/releases/1001/note", { notes: null });
    expect((await get<ReleaseDetail>("/api/releases/1001")).body.note).toBeNull();
  });

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

  it("narrows the queue and its counts to a label or artist, and finds them by name", async () => {
    const q = await get<QueueResponse>("/api/queue?scope=label:78");
    expect(q.body.items.map((i) => i.id)).toEqual([1006]);
    expect(q.body.remaining).toBe(1);
    expect((await get<Stats>("/api/stats?scope=artist:12")).body).toMatchObject({
      remaining: 2,
      scopeRemaining: 1,
    });
    expect((await get<Stats>("/api/stats")).body.scopeRemaining).toBeNull();
    for (const scope of ["shop:1", "label:0", "label"])
      expect((await get(`/api/queue?scope=${scope}`)).status).toBe(400);
    expect((await get("/api/stats?scope=artist:x")).status).toBe(400);

    const found = await get<ScopeSearchResponse>("/api/scopes?q=renegade%20hardware%20ltd");
    expect(found.body.items).toEqual([
      { kind: "label", id: 78, name: "Renegade Hardware Ltd.", records: 1 },
    ]);
    expect((await get("/api/scopes?q=%20r%20")).status).toBe(400);
    expect((await get("/api/scopes")).status).toBe(400);
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

  it("files a verdict under the record its release is on now, whatever key the page sent", async () => {
    // 1001 is on master 501; a page that read the queue before a load may still say r:1001.
    const saved = await send<Verdict>("POST", "/api/verdicts", {
      key: "r:1001",
      releaseId: 1001,
      status: "rejected",
    });

    expect(saved.body.key).toBe("m:501");
    expect(db.prepare("SELECT key FROM verdicts").pluck().all()).toEqual(["m:501"]);
  });

  it("writes, lists and undoes verdicts and track verdicts", async () => {
    const v = await send<Verdict>("POST", "/api/verdicts", {
      key: "m:501",
      status: "accepted",
      releaseId: 1001,
    });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ key: "m:501", status: "accepted", source: "triage" });
    // The want puts Renegade Hardware among the coverage labels, which lets its undated 1003 in.
    expect((await get<QueueResponse>("/api/queue")).body.items.map((i) => i.id)).toEqual([
      1006, 1003,
    ]);
    expect((await send("POST", "/api/verdicts", { key: "nope", status: "accepted" })).status).toBe(
      400,
    );
    const tv = await send<{ mark: string }>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "keep",
    });
    expect(tv.body.mark).toBe("keep");
    const noted = await send<TrackVerdict>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "keep",
      notes: "the drop at 3:10",
    });
    const remarked = await send<TrackVerdict>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "candidate",
    });
    expect(remarked.body.notes).toBe("the drop at 3:10");
    expect(noted.body.decidedAt <= remarked.body.decidedAt).toBe(true);
    await send("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "keep",
    });
    const marks = await get<TrackMarksResponse>("/api/track-marks");
    expect(marks.body.items).toEqual([
      expect.objectContaining({
        mark: expect.objectContaining({ position: "B1", mark: "keep", notes: "the drop at 3:10" }),
        track: { artistDisplay: "Ed Rush & Optical", title: "Watermelon", durationSeconds: 421 },
        release: expect.objectContaining({ id: 1001, catno: "RH 20" }),
        verdict: expect.objectContaining({ key: "m:501", status: "accepted" }),
      }),
    ]);
    const detail = await get<ReleaseDetail>("/api/releases/1001");
    expect(detail.body.tracks[2]!.mark).toBe("keep");
    expect(detail.body.verdict!.status).toBe("accepted");
    const twelves = await get<TwelvesResponse>("/api/twelves?status=accepted");
    expect(twelves.body.items).toHaveLength(1);
    expect(twelves.body.items[0]!.release!.id).toBe(1001);
    const undo = await send<{ deleted: boolean }>("DELETE", undoUrl(detail.body.verdict!));
    expect(undo.body.deleted).toBe(true);
    expect((await get<QueueResponse>("/api/queue")).body.remaining).toBe(2);
  });

  it("refuses an undo or a change from Twelves once another tab decided the record again", async () => {
    const want = await send<Verdict>("POST", "/api/verdicts", {
      key: "m:501",
      releaseId: 1001,
      status: "accepted",
    });
    const grail = await send<Verdict>("POST", "/api/verdicts", {
      key: "m:501",
      releaseId: 1001,
      status: "candidate",
    });
    const changed = {
      status: 409,
      body: {
        error:
          "The record's verdict changed since this page read it, in another tab or by a load; reload to see it",
      },
    };

    expect(await send("DELETE", undoUrl(want.body))).toEqual(changed);
    const rejudged = { key: "m:501", releaseId: 1001, status: "maybe" };
    expect(
      await send("POST", "/api/verdicts", { ...rejudged, expected: expectedVerdict(want.body) }),
    ).toEqual(changed);
    expect((await get<ReleaseDetail>("/api/releases/1001")).body.verdict).toEqual(grail.body);

    const maybe = await send("POST", "/api/verdicts", {
      ...rejudged,
      expected: expectedVerdict(grail.body),
    });
    expect(maybe.body).toMatchObject({ key: "m:501", status: "maybe" });
    expect((await send("DELETE", "/api/verdicts/m:501")).status).toBe(400);
  });

  it("keeps a mark's tune and moment when a later dump renames its position", async () => {
    const marked = await send<TrackVerdict>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "candidate",
      videoId: "aaaaaaaaaa1",
      atSeconds: 190.5,
    });
    expect(marked.body).toMatchObject({
      heardKey: "ed rush 2 and optical - watermelon",
      videoId: "aaaaaaaaaa1",
      atSeconds: 190.5,
    });
    // A note written in Twelves sends no moment and keeps the saved one.
    const noted = await send<TrackVerdict>("POST", "/api/track-verdicts", {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "candidate",
      notes: "the vocal",
    });
    expect(noted.body).toMatchObject({ videoId: "aaaaaaaaaa1", atSeconds: 190.5 });
    expect(
      (
        await send("POST", "/api/track-verdicts", {
          releaseId: 1001,
          position: "B1",
          tune: tuneAt(db, 1001, "B1"),
          mark: "keep",
          videoId: "aaaaaaaaaa1",
        })
      ).status,
    ).toBe(400);

    db.prepare(
      "UPDATE tracks SET position = 'B' WHERE release_id = 1001 AND position = 'B1'",
    ).run();
    const marks = await get<TrackMarksResponse>("/api/track-marks");
    expect(marks.body.items[0]).toMatchObject({
      mark: { position: "B1", heardKey: "ed rush 2 and optical - watermelon", atSeconds: 190.5 },
      track: { artistDisplay: "Ed Rush & Optical", title: "Watermelon", durationSeconds: 421 },
      tracklistChanged: false,
    });
  });

  it("logs listens and marks tracks heard everywhere the tune appears, under any credited name", async () => {
    const log = await send<{ id: number; heardKey: string | null }>("POST", "/api/listen-log", {
      releaseId: 1006,
      position: "A",
      videoId: "dddddddddd1",
      seconds: 12,
    });
    expect(log.body.heardKey).toBe("konflict - messiah");
    // 1006 credits Konflict as Konflikt; the sampler credits him under his own name.
    const sampler = await get<ReleaseDetail>("/api/releases/1003");
    expect(sampler.body.tracks.slice(0, 2).map((track) => track.heard)).toEqual([true, false]);
    await send("POST", "/api/listen-log", {
      releaseId: 1003,
      position: "AA",
      videoId: "bbbbbbbbbb1",
      seconds: 4,
    });
    const stats = await get<Stats>("/api/stats");
    expect(stats.body.heardTracks).toBe(2);
    expect(stats.body.universe).toEqual({ releases: 5, keys: 4, filteredKeys: 2 });
    expect(stats.body.remaining).toBe(2);
  });

  it("logs a play too short to count without making its tune heard", async () => {
    const tap = await send<{ id: number; heardKey: string | null }>("POST", "/api/listen-log", {
      releaseId: 1001,
      position: "B1",
      videoId: "aaaaaaaaaa1",
      seconds: 1.7,
      heard: false,
    });
    expect(tap.body.heardKey).toBeNull();
    expect(db.prepare("SELECT position, seconds FROM listen_log").all()).toEqual([
      { position: "B1", seconds: 1.7 },
    ]);
    expect((await get<ReleaseDetail>("/api/releases/1001")).body.tracks[2]!.heard).toBe(false);
    expect((await get<Stats>("/api/stats")).body.heardTracks).toBe(0);
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

  it("preserves the active settings when saving fails", async () => {
    await send("PUT", "/api/settings", DEFAULT_CONFIG);
    const configFile = path.join(tmp, "digga.config.json");
    fs.rmSync(configFile);
    fs.mkdirSync(configFile);

    const response = await send("PUT", "/api/settings", {
      ...DEFAULT_CONFIG,
      discogs: { ...DEFAULT_CONFIG.discogs, username: "changed" },
    });

    expect(response.status).toBe(500);
    expect(server.getConfig()).toEqual(DEFAULT_CONFIG);
    expect((await get("/api/settings")).body).toEqual(DEFAULT_CONFIG);
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
    // A shop read needs a seller's username.
    expect((await send("POST", "/api/jobs/import/seller", {})).status).toBe(400);
    expect((await send("POST", "/api/jobs/import/seller", { username: " " })).status).toBe(400);
    const imp = await send<Job>("POST", "/api/jobs/import/history", {
      path: "/definitely/missing/History",
    });
    expect(imp.status).toBe(202);
    expect((await waitForJob(imp.body.id)).status).toBe("failed");
    expect((await get("/api/jobs/missing")).status).toBe(404);
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

  it("refuses to listen on a network address", async () => {
    await expect(server.start(0, "0.0.0.0")).rejects.toThrow("not a loopback address");
  });
});

describe("requests from outside the app", () => {
  const verdict = JSON.stringify({ key: "m:501", status: "accepted", releaseId: 1001 });
  const savedVerdict = () => db.prepare("SELECT key FROM verdicts").all();

  it("refuses a request that names another host, as a rebound domain does", async () => {
    const write = await server.app.request("http://untrusted.example/api/verdicts", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://untrusted.example" },
      body: verdict,
    });
    const read = await server.app.request("http://untrusted.example/api/settings");

    expect(write.status).toBe(403);
    expect(read.status).toBe(403);
    expect(savedVerdict()).toEqual([]);
  });

  it("refuses a write from another site's page or another local port", async () => {
    for (const origin of ["https://untrusted.example", "http://localhost:8080"]) {
      const response = await server.app.request("http://localhost:3456/api/verdicts", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: verdict,
      });
      expect(response.status).toBe(403);
    }
    expect(savedVerdict()).toEqual([]);
  });

  it("takes a write from its own page under either name, and from a tool without an origin", async () => {
    const own = await server.app.request("http://127.0.0.1:3456/api/verdicts", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3456" },
      body: verdict,
    });
    const tool = await send("DELETE", undoUrl((await own.json()) as Verdict));

    expect(own.status).toBe(200);
    expect(tool.status).toBe(200);
  });

  it("refuses a body that is not JSON, or that is too large", async () => {
    const plain = await server.app.request("/api/verdicts", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: verdict,
    });
    const huge = await send("PUT", "/api/settings", { padding: "x".repeat(5 * 1024 * 1024) });

    expect(plain.status).toBe(415);
    expect(huge.status).toBe(413);
    expect(savedVerdict()).toEqual([]);
  });
});

describe("createServer with its own database file", () => {
  it("opens paths.dbFile and applies migrations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-own-"));
    const paths = resolvePaths({ dataDir: dir });
    const own = createServer({
      config: DEFAULT_CONFIG,
      paths,
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
    });
    const res = await own.app.request("/api/stats");
    expect(res.status).toBe(200);
    await own.stop();
    const check = openDb(paths.dbFile, { readonly: true });
    const latest = listMigrations().at(-1)!.version;
    expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({
      value: String(latest),
    });
    check.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads a dump in a worker with its own connection", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-worker-"));
    const own = createServer({
      config: DEFAULT_CONFIG,
      paths: resolvePaths({ dataDir: dir }),
      secrets: testSecrets(),
      logger: silentLogger,
      serveStatic: false,
    });
    try {
      const res = await own.app.request("/api/jobs/dump-load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: FIXTURE_GZ }),
      });
      const job = (await res.json()) as Job;
      await expect.poll(() => own.jobs.get(job.id)?.status, { timeout: 10_000 }).toBe("done");
      expect(own.jobs.get(job.id)?.progress).toMatchObject({ phase: "done", matched: 5 });
      expect(own.db.prepare("SELECT COUNT(*) FROM releases").pluck().get()).toBe(5);
    } finally {
      await own.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
