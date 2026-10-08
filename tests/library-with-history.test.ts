import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import {
  backupDecisionsDaily,
  readDecisionsBackup,
  writeDecisionsBackup,
} from "../src/server/decisions-backup.ts";
import { restoreBackedUpData } from "../src/server/db/user-data.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import type { JobsResponse, QueueResponse, Stats } from "../src/shared/api.ts";
import { type Config, DEFAULT_CONFIG } from "../src/shared/config.ts";
import { fixtureDb, silentLogger, testSecrets } from "./helpers.ts";

// Libraries from before Digga stopped reading browser history (decision 171) keep the records
// that import marked seen, and may hold its job rows.

const SEEN = {
  key: "m:501",
  status: "seen",
  source: "seed:history",
  releaseId: 1001,
  decidedAt: "2026-08-20T18:00:00.000Z",
  updatedAt: "2026-08-20T18:00:00.000Z",
} as const;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-history-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The fixture library with a record seen in the browser history and that import's job. */
async function libraryFromBeforeTheRemoval(): Promise<Db> {
  const db = await fixtureDb();
  upsertVerdict(db, SEEN);
  db.prepare(
    `INSERT INTO jobs (id, type, status, progress_json, error, created_at, started_at, finished_at)
     VALUES ('history-1', 'import_history', 'done', @progress, NULL, @at, @at, @at)`,
  ).run({
    progress: JSON.stringify({ files: 1, urls: 9, discogsUrls: 2, keys: 1, verdictsWritten: 1 }),
    at: "2026-08-21T10:00:00.000Z",
  });
  return db;
}

function serverOn(db: Db, config: Config = DEFAULT_CONFIG): DiggaServer {
  const paths = resolvePaths({ dataDir: dir });
  paths.dbFile = ":memory:";
  return createServer({
    config,
    paths,
    secrets: testSecrets(),
    logger: silentLogger,
    db,
    serveStatic: false,
    persistConfig: false,
  });
}

async function get<T>(server: DiggaServer, url: string): Promise<{ status: number; body: T }> {
  const response = await server.app.request(url);
  return { status: response.status, body: (await response.json()) as T };
}

describe("a library from before the browser history import was removed", () => {
  it("opens, lists its jobs without the import's, and keeps skipping the records seen", async () => {
    const db = await libraryFromBeforeTheRemoval();
    const server = serverOn(db);
    try {
      await server.jobs.runAndWait("import_wantlist", async () => null);

      const jobs = await get<JobsResponse>(server, "/api/jobs");
      expect(jobs.status).toBe(200);
      expect(jobs.body.jobs.map((job) => job.type)).toEqual(["import_wantlist"]);
      expect((await get(server, "/api/jobs/history-1")).status).toBe(404);
      expect(server.jobs.list().map((job) => job.type)).toEqual(["import_wantlist"]);

      const stats = await get<Stats>(server, "/api/stats");
      expect(stats.body.verdicts.seen).toBe(1);
      const queue = await get<QueueResponse>(server, "/api/queue?limit=100");
      expect(queue.body.items.map((item) => item.triageKey)).not.toContain(SEEN.key);
    } finally {
      await server.stop();
    }

    const digging = serverOn(db, {
      ...DEFAULT_CONFIG,
      filters: { ...DEFAULT_CONFIG.filters, skipHistory: false },
    });
    try {
      const queue = await get<QueueResponse>(digging, "/api/queue?limit=100");
      expect(queue.body.items.map((item) => item.triageKey)).toContain(SEEN.key);
    } finally {
      await digging.stop();
      db.close();
    }
  });

  it("refuses to start the import", async () => {
    const db = await libraryFromBeforeTheRemoval();
    const server = serverOn(db);
    try {
      const response = await server.app.request("/api/jobs/import/history", { method: "POST" });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Unknown import kind; expected one of collection, wantlist, list, seller",
      });
      expect(server.jobs.list()).toEqual([]);
    } finally {
      await server.stop();
      db.close();
    }
  });

  it("restores the records seen from a decisions backup of every version", async () => {
    const source = await libraryFromBeforeTheRemoval();
    const written = await writeDecisionsBackup(source, backupDay());
    source.close();
    const current = readDecisionsBackup(written.file);
    const backups = [current, olderBackup(1), olderBackup(2)];
    expect(backups.map((backup) => backup.version)).toEqual([3, 1, 2]);

    for (const backup of backups) {
      const target = await fixtureDb();
      const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

      expect(outcome.verdicts.restored).toBe(1);
      expect(getVerdict(target, SEEN.key)).toMatchObject({
        status: "seen",
        source: "seed:history",
        releaseId: SEEN.releaseId,
        decidedAt: SEEN.decidedAt,
      });
      target.close();
    }
  });

  it("is backed up daily when the records seen are all it holds", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, SEEN);

    const written = await backupDecisionsDaily(db, backupDay());

    expect(written).not.toBeNull();
    expect(readDecisionsBackup(written!.file).verdicts).toEqual([
      expect.objectContaining({ key: SEEN.key, source: "seed:history" }),
    ]);
    db.close();
  });
});

function backupDay() {
  return { dir, day: "2026-09-10", now: new Date("2026-09-10T12:00:00.000Z") };
}

/** A version 1 or 2 backup, one JSON document, holding the record seen. */
function olderBackup(version: 1 | 2): ReturnType<typeof readDecisionsBackup> {
  const file = path.join(dir, `decisions-v${version}.json`);
  const { updatedAt: _updatedAt, ...verdict } = SEEN;
  const notes = version === 2 ? { notes: null, dugAt: null } : {};
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: "digga",
      kind: "decisions",
      version,
      backedUpAt: "2026-09-10T12:00:00.000Z",
      verdicts: [{ ...verdict, ...notes }],
      trackMarks: [],
      heardTunes: [],
      attachedVideos: [],
      noAudioVideos: [],
    }),
  );
  return readDecisionsBackup(file);
}
