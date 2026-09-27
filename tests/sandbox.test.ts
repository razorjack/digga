import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Api, createHttpApi } from "../src/client/api.ts";
import { createSandboxApi, JOB_STEPS } from "../src/client/sandbox.ts";
import type { Db } from "../src/server/db/db.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { EnrichProgress } from "../src/shared/types.ts";
import { fixtureDb, silentLogger } from "./helpers.ts";

const WRITES = [
  "postVerdict",
  "deleteVerdict",
  "postTrackVerdict",
  "postListenLog",
  "putSettings",
  "startEnrich",
  "startDumpLoad",
  "startImport",
  "cancelJob",
  "pushToWantlist",
] as const;

let tmp: string;
let db: Db;
let server: DiggaServer;
let sandbox: Api;
let apiUrl: string;

const forbidden = (name: string) => () => {
  throw new Error(`sandbox called ${name} on the server`);
};

function tableCounts(): Record<string, number> {
  const tables = ["verdicts", "track_verdicts", "listen_log", "heard_tracks", "jobs"];
  return Object.fromEntries(
    tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digga-sandbox-"));
  db = await fixtureDb();
  const paths = resolvePaths({ baseDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: { getDiscogsToken: () => undefined },
    logger: silentLogger,
    db,
    serveStatic: false,
  });
  const info = await server.start(0);
  apiUrl = `${info.url}/api`;
  const http = createHttpApi(apiUrl);
  const inner: Api = { ...http, ...Object.fromEntries(WRITES.map((w) => [w, forbidden(w)])) };
  sandbox = createSandboxApi(inner, { pushDelayMs: 1, jobTickMs: 1 });
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sandbox api", () => {
  it("fakes verdicts and undo on top of the real queue", async () => {
    const before = tableCounts();
    expect(sandbox.mode).toBe("sandbox");
    const q = await sandbox.getQueue();
    expect(q.items.map((i) => i.id)).toEqual([1006, 1001]);
    expect(q.remaining).toBe(2);

    const v = await sandbox.postVerdict({ key: "m:506", status: "rejected", releaseId: 1006 });
    expect(v).toMatchObject({ key: "m:506", status: "rejected", source: "triage" });
    const after = await sandbox.getQueue();
    expect(after.items.map((i) => i.id)).toEqual([1001]);
    expect(after.remaining).toBe(1);
    expect((await sandbox.getRelease(1006)).verdict?.status).toBe("rejected");
    const stats = await sandbox.getStats();
    expect(stats.remaining).toBe(1);
    expect(stats.verdicts.rejected).toBe(1);

    expect(await sandbox.deleteVerdict("m:506")).toMatchObject({ deleted: true });
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1006, 1001]);
    expect(await sandbox.deleteVerdict("m:506")).toEqual({ deleted: false, previous: null });
    await expect(sandbox.postVerdict({ key: "nope", status: "accepted" })).rejects.toThrow();
    expect(tableCounts()).toEqual(before);
  });

  it("pages past sandbox verdicts when they fill a whole server page", async () => {
    const paged = createSandboxApi(createHttpApi(apiUrl), { queuePageLimit: 1 });
    await paged.getQueue();
    await paged.postVerdict({ key: "m:506", status: "rejected", releaseId: 1006 });
    expect((await paged.getQueue({ limit: 1 })).items.map((i) => i.id)).toEqual([1001]);
    await paged.postVerdict({ key: "m:501", status: "rejected", releaseId: 1001 });
    const empty = await paged.getQueue({ limit: 1 });
    expect(empty.items).toEqual([]);
    expect(empty.remaining).toBe(0);
  });

  it("marks tunes heard across releases and keeps track marks in memory", async () => {
    await sandbox.getRelease(1001);
    const log = await sandbox.postListenLog({
      releaseId: 1001,
      position: "A1",
      videoId: "aaaaaaaaaa1",
      seconds: 5,
    });
    expect(log.heardKey).toBe("ed rush and optical - wormhole");
    expect((await sandbox.getRelease(1002)).tracks[0]!.heard).toBe(true);
    expect((await sandbox.getStats()).heardTracks).toBe(1);

    await sandbox.postTrackVerdict({ releaseId: 1001, position: "B1", mark: "keep" });
    const marked = await sandbox.getRelease(1001);
    expect(marked.tracks[2]!.mark).toBe("keep");
    expect(marked.trackVerdicts.map((t) => t.position)).toEqual(["B1"]);
    await sandbox.postTrackVerdict({ releaseId: 1001, position: "B1", mark: null });
    expect((await sandbox.getRelease(1001)).tracks[2]!.mark).toBeNull();
    expect(tableCounts()).toMatchObject({ listen_log: 0, heard_tracks: 0, track_verdicts: 0 });
  });

  it("shows fake decisions in Twelves and pretends to push to the wantlist", async () => {
    await sandbox.getQueue();
    await sandbox.postVerdict({ key: "m:501", status: "accepted", releaseId: 1001 });
    const twelves = await sandbox.getTwelves({ status: ["accepted"] });
    expect(twelves.items.map((i) => [i.verdict.key, i.release?.id])).toEqual([["m:501", 1001]]);
    expect(await sandbox.pushToWantlist(1001, { notes: "wheel up" })).toEqual({
      releaseId: 1001,
      ok: true,
    });
    expect(tableCounts().verdicts).toBe(0);
  });

  it("keeps settings in memory and previews them on the queue", async () => {
    const settings = await sandbox.getSettings();
    const open = { ...settings.filters, yearFrom: null, yearTo: null, formats: [] };
    await sandbox.putSettings({ ...settings, filters: open });
    expect((await sandbox.getSettings()).filters.formats).toEqual([]);
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1004, 1006, 1001]);
    expect((await sandbox.getStats()).universe.filteredKeys).toBe(3);
    expect(server.getConfig().filters.formats).toEqual(["Vinyl"]);
    expect(fs.existsSync(path.join(tmp, "digga.config.json"))).toBe(false);
  });

  it("simulates jobs without starting them on the server", async () => {
    const job = await sandbox.startEnrich({ ahead: 12 });
    expect(job.status).toBe("running");
    const other = await sandbox.startImport("wantlist");
    expect((await sandbox.cancelJob(other.id)).cancelled).toBe(true);
    for (let i = 0; i < 100; i += 1) {
      if ((await sandbox.getJob(job.id)).status === "done") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const done = await sandbox.getJob(job.id);
    expect(done.status).toBe("done");
    expect((done.progress as EnrichProgress).done).toBe(12);
    expect(JOB_STEPS).toBeGreaterThan(1);
    const list = await sandbox.getJobs();
    expect(list.jobs.map((j) => j.status).sort()).toEqual(["cancelled", "done"]);
    expect(tableCounts().jobs).toBe(0);
  });
});
