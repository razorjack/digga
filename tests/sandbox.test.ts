import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Api, ApiRequestError, createAppApi, createHttpApi } from "../src/client/api.ts";
import { createSandboxApi } from "../src/client/sandbox.ts";
import type { Db } from "../src/server/db/db.ts";
import { applySeedVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { fixtureDb, silentLogger, testSecrets } from "./helpers.ts";

/** The digging writes: the sandbox must never send these to the server. */
const WRITES = [
  "postVerdict",
  "deleteVerdict",
  "postTrackVerdict",
  "postListenLog",
  "pushToWantlist",
  "removeFromWantlist",
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
  const paths = resolvePaths({ dataDir: tmp, distDir: path.join(tmp, "dist") });
  paths.dbFile = ":memory:";
  server = createServer({
    config: DEFAULT_CONFIG,
    paths,
    secrets: testSecrets(),
    logger: silentLogger,
    db,
    serveStatic: false,
    // Nothing leaves the machine: YouTube title lookups find nothing.
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  const info = await server.start(0);
  apiUrl = `${info.url}/api`;
  const http = createHttpApi(apiUrl);
  const inner: Api = {
    ...http,
    ...Object.fromEntries(WRITES.map((w) => [w, forbidden(w)])),
    startImport: (kind, input) =>
      kind === "list" ? forbidden("startImport(list)")() : http.startImport(kind, input),
  };
  sandbox = createSandboxApi(inner, { pushDelayMs: 1 });
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sandbox api", () => {
  it("revisits browser history and restores its exclusion state on undo", async () => {
    applySeedVerdict(db, { key: "m:501", status: "seen", source: "seed:history", releaseId: 1001 });
    const config = await sandbox.getSettings();
    await sandbox.putSettings({ ...config, filters: { ...config.filters, skipHistory: false } });
    const detail = await sandbox.getRelease(1001);
    expect((await sandbox.getQueue()).remaining).toBe(2);
    await sandbox.postVerdict({ key: "m:501", status: "rejected", releaseId: 1001 });
    expect((await sandbox.getQueue()).remaining).toBe(1);
    await sandbox.postVerdict(detail.verdict!);
    expect((await sandbox.getQueue()).items.map((release) => release.id)).toContain(1001);
    expect((await sandbox.getStats()).remaining).toBe(2);
  });

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

    expect(await sandbox.deleteVerdict("m:506", v)).toMatchObject({ deleted: true });
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1006, 1001]);
    expect(await sandbox.deleteVerdict("m:506", v)).toEqual({ deleted: false, previous: null });
    await expect(sandbox.postVerdict({ key: "nope", status: "accepted" })).rejects.toThrow();
    expect(tableCounts()).toEqual(before);
  });

  it("counts the records dug on the server, and adds its own", async () => {
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", releaseId: 1001 });
    expect((await sandbox.getStats()).dug).toBe(1);

    await sandbox.getRelease(1001);
    await sandbox.postVerdict({ key: "m:501", status: "maybe", source: "manual", releaseId: 1001 });
    const skip = await sandbox.postVerdict({ key: "m:506", status: "rejected", releaseId: 1006 });
    expect((await sandbox.getStats()).dug).toBe(2);
    await sandbox.deleteVerdict("m:506", skip);
    expect((await sandbox.getStats()).dug).toBe(1);
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

  it("subtracts only the scope's own sandbox verdicts from its count", async () => {
    const konflict = { kind: "artist", id: 21 } as const;
    await sandbox.getQueue();
    await sandbox.postVerdict({ key: "m:501", status: "rejected", releaseId: 1001 });
    const scoped = await sandbox.getQueue({ scope: konflict });
    expect(scoped.items.map((i) => i.id)).toEqual([1006]);
    expect(scoped.remaining).toBe(1);
    expect(await sandbox.getStats({ scope: konflict })).toMatchObject({
      remaining: 1,
      scopeRemaining: 1,
    });

    await sandbox.postVerdict({ key: "m:506", status: "rejected", releaseId: 1006 });
    const empty = await sandbox.getQueue({ scope: konflict });
    expect([empty.items, empty.remaining]).toEqual([[], 0]);
    expect(await sandbox.getStats({ scope: konflict })).toMatchObject({
      remaining: 0,
      scopeRemaining: 0,
    });
    expect((await sandbox.getStats()).scopeRemaining).toBeNull();
    expect((await sandbox.searchScopes("konflict")).items).toHaveLength(1);
  });

  it("leaves a tune unheard after a play too short to count", async () => {
    await sandbox.getRelease(1001);
    const tap = await sandbox.postListenLog({
      releaseId: 1001,
      position: "A1",
      videoId: "aaaaaaaaaa1",
      seconds: 2,
      heard: false,
    });
    expect(tap.heardKey).toBeNull();
    expect((await sandbox.getRelease(1001)).tracks[0]!.heard).toBe(false);
    expect(tableCounts()).toMatchObject({ listen_log: 0 });
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

    await sandbox.postTrackVerdict({
      releaseId: 1001,
      position: "B1",
      mark: "keep",
      notes: "drop",
      videoId: "aaaaaaaaaa1",
      atSeconds: 190.5,
    });
    const marked = await sandbox.getRelease(1001);
    expect(marked.tracks[2]!.mark).toBe("keep");
    expect(marked.trackVerdicts.map((t) => t.position)).toEqual(["B1"]);
    await sandbox.postTrackVerdict({ releaseId: 1001, position: "B1", mark: "candidate" });
    const listed = await sandbox.getTrackMarks();
    expect(listed.items).toEqual([
      expect.objectContaining({
        mark: expect.objectContaining({
          position: "B1",
          mark: "candidate",
          notes: "drop",
          heardKey: "ed rush and optical - watermelon",
          videoId: "aaaaaaaaaa1",
          atSeconds: 190.5,
        }),
        track: expect.objectContaining({ title: "Watermelon" }),
        release: expect.objectContaining({ id: 1001 }),
      }),
    ]);
    await sandbox.postTrackVerdict({ releaseId: 1001, position: "B1", mark: null });
    expect((await sandbox.getRelease(1001)).tracks[2]!.mark).toBeNull();
    expect((await sandbox.getTrackMarks()).items).toEqual([]);
    expect(tableCounts()).toMatchObject({ listen_log: 0, heard_tracks: 0, track_verdicts: 0 });
  });

  it("brings a sandbox no-audio record back when a link is attached", async () => {
    await sandbox.getQueue();
    await sandbox.postVerdict({ key: "m:506", status: "no_audio", releaseId: 1006 });
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1001]);
    const detail = await sandbox.attachVideo(1006, "https://youtu.be/hhhhhhhhhh1");
    expect(detail.videos.map((video) => video.videoId)).toContain("hhhhhhhhhh1");
    expect(detail.verdict).toBeNull();
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1006, 1001]);
  });

  it("shows fake decisions in Twelves and pretends to push to the wantlist", async () => {
    await sandbox.getQueue();
    await sandbox.postVerdict({ key: "m:501", status: "accepted", releaseId: 1001 });
    const twelves = await sandbox.getTwelves({ status: ["accepted"] });
    expect(twelves.items.map((i) => [i.key, i.release?.id, i.membership.onWantlist])).toEqual([
      ["m:501", 1001, false],
    ]);
    expect(await sandbox.pushToWantlist(1001)).toEqual({
      releaseId: 1001,
      ok: true,
    });
    const onWantlist = async () =>
      (await sandbox.getTwelves({ status: ["accepted"] })).items[0]!.membership.onWantlist;
    expect(await onWantlist()).toBe(true);
    await sandbox.removeFromWantlist(1001);
    expect(await onWantlist()).toBe(false);
    expect(tableCounts().verdicts).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM memberships").pluck().get()).toBe(0);
  });

  it("restores a verdict with its original date", async () => {
    await sandbox.getQueue();
    const at = "2026-01-02T03:04:05.000Z";
    await sandbox.postVerdict({ key: "m:501", status: "snoozed", releaseId: 1001, decidedAt: at });
    const item = (await sandbox.getTwelves({ status: ["snoozed"] })).items[0]!;
    expect(item.verdict?.decidedAt).toBe(at);
  });

  it("saves settings on the server, since they set the app up rather than dig", async () => {
    const settings = await sandbox.getSettings();
    const open = { ...settings.filters, yearFrom: null, yearTo: null, formats: [] };
    await sandbox.putSettings({ ...settings, filters: open });
    expect(server.getConfig().filters.formats).toEqual([]);
    expect((await sandbox.getQueue()).items.map((i) => i.id)).toEqual([1004, 1006, 1001]);
    expect((await sandbox.getStats()).universe.filteredKeys).toBe(3);
  });

  it("sends setup jobs to the server", async () => {
    const err = await sandbox.startDumpLoad({ file: "missing.xml.gz" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).message).toMatch(/Dump file not found/);
    await expect(sandbox.getJob("nope")).rejects.toThrow(/Job not found/);
  });
});

describe("app api", () => {
  it("starts in a sandbox, switches to the server's writes and back to a fresh sandbox", async () => {
    const app = createAppApi(createHttpApi(apiUrl), (inner) =>
      createSandboxApi(inner, { pushDelayMs: 1 }),
    );
    expect([app.mode, app.generation]).toEqual(["sandbox", 0]);
    await app.getQueue();
    await app.postVerdict({ key: "m:506", status: "rejected", releaseId: 1006 });
    const firstSandbox = app.pinned();
    expect(tableCounts().verdicts).toBe(0);

    app.setSandbox(false);
    app.setSandbox(false);
    expect([app.mode, app.generation]).toEqual(["live", 1]);
    // The server's own sandbox setting still refuses the write.
    const refused = await app
      .postVerdict({ key: "m:501", status: "rejected", releaseId: 1001 })
      .catch((e: unknown) => e);
    expect((refused as ApiRequestError).status).toBe(409);

    await app.putSettings({ ...(await app.getSettings()), sandbox: false });
    await app.postVerdict({ key: "m:501", status: "rejected", releaseId: 1001 });
    expect(tableCounts().verdicts).toBe(1);
    // A write through the sandbox pinned before the switch stays fake.
    await firstSandbox.postVerdict({ key: "m:504", status: "accepted", releaseId: 1004 });
    expect(tableCounts().verdicts).toBe(1);

    app.setSandbox(true);
    expect([app.mode, app.generation]).toEqual(["sandbox", 2]);
    expect((await app.getQueue()).items.map((i) => i.id)).toEqual([1006]);
  });
});
