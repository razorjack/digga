import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { applyMigrations, type Db, listMigrations, openDb } from "../src/server/db/db.ts";
import { deleteVerdict, setTrackVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { fixtureDb, tuneAt } from "./helpers.ts";

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

async function library(): Promise<Db> {
  const db = await fixtureDb();
  opened.push(db);
  return db;
}

/** Applies the migrations up to `version`, as a library of that age has them. */
function migrateTo(db: Db, version: number): void {
  const early = fs.mkdtempSync(path.join(os.tmpdir(), "digga-migrations-"));
  try {
    for (const migration of listMigrations().filter((m) => m.version <= version))
      fs.copyFileSync(migration.file, path.join(early, migration.name));
    applyMigrations(db, early);
  } finally {
    fs.rmSync(early, { recursive: true, force: true });
  }
}

function migrating(): Db {
  const db = openDb(":memory:", { foreign: true });
  opened.push(db);
  return db;
}

function verdictLog(db: Db): Record<string, unknown>[] {
  return db
    .prepare("SELECT change, key, previous_key, status, source, notes FROM verdict_log ORDER BY id")
    .all() as Record<string, unknown>[];
}

function trackMarkLog(db: Db): Record<string, unknown>[] {
  return db
    .prepare("SELECT change, position, mark, notes, at_seconds FROM track_mark_log ORDER BY id")
    .all() as Record<string, unknown>[];
}

describe("the decision log", () => {
  it("keeps every verdict made in Digga through a re-judgement and an undo that deletes it", async () => {
    const db = await library();
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage", releaseId: 1001 });
    upsertVerdict(db, { key: "m:501", status: "rejected", source: "triage", releaseId: 1001 });
    deleteVerdict(db, "m:501");

    const logged = (change: string, status: string) => ({
      change,
      key: "m:501",
      previous_key: null,
      status,
      source: "triage",
      notes: null,
    });
    expect(verdictLog(db)).toEqual([
      logged("insert", "accepted"),
      logged("update", "rejected"),
      logged("delete", "rejected"),
    ]);
  });

  it("records nothing when a write leaves the verdict as it was", async () => {
    const db = await library();
    const verdict = {
      key: "m:501",
      status: "rejected",
      source: "triage",
      releaseId: 1001,
      decidedAt: "2026-10-03T10:00:00.000Z",
    } as const;
    upsertVerdict(db, verdict);
    upsertVerdict(db, verdict);

    expect(verdictLog(db).map((entry) => entry.change)).toEqual(["insert"]);
  });

  it("names the key a verdict moved from", async () => {
    const db = await library();
    upsertVerdict(db, { key: "r:1006", status: "maybe", source: "triage", releaseId: 1006 });
    db.prepare("UPDATE verdicts SET key = 'm:506' WHERE key = 'r:1006'").run();

    expect(verdictLog(db).at(-1)).toMatchObject({
      change: "update",
      key: "m:506",
      previous_key: "r:1006",
    });
  });

  it("logs every change to a track mark, its note and its clearing", async () => {
    const db = await library();
    const track = { releaseId: 1001, position: "B1", tune: tuneAt(db, 1001, "B1") };
    setTrackVerdict(db, { ...track, mark: "keep", videoId: "aaaaaaaaaa1", atSeconds: 61.5 });
    setTrackVerdict(db, { ...track, mark: "candidate", videoId: "aaaaaaaaaa1", atSeconds: 90 });
    setTrackVerdict(db, { ...track, mark: "candidate", notes: "the vocal" });
    setTrackVerdict(db, { ...track, mark: null });

    expect(trackMarkLog(db)).toEqual([
      { change: "insert", position: "B1", mark: "keep", notes: null, at_seconds: 61.5 },
      { change: "update", position: "B1", mark: "candidate", notes: null, at_seconds: 90 },
      { change: "update", position: "B1", mark: "candidate", notes: "the vocal", at_seconds: 90 },
      { change: "delete", position: "B1", mark: "candidate", notes: "the vocal", at_seconds: 90 },
    ]);
  });

  it("starts from the verdicts and marks a library already has", () => {
    const early = fs.mkdtempSync(path.join(os.tmpdir(), "digga-migrations-"));
    const db = openDb(":memory:", { foreign: true });
    opened.push(db);
    try {
      for (const migration of listMigrations().filter((m) => m.version <= 7))
        fs.copyFileSync(migration.file, path.join(early, migration.name));
      applyMigrations(db, early);
      db.prepare(
        `INSERT INTO verdicts (key, status, source, release_id, decided_at)
         VALUES ('m:501', 'wantlist', 'seed:wantlist', 1001, '2026-09-27T18:49:47.521Z')`,
      ).run();
      db.prepare(
        `INSERT INTO track_verdicts (release_id, position, mark, decided_at)
         VALUES (1001, 'B1', 'keep', '2026-09-28T10:00:00.000Z')`,
      ).run();
      applyMigrations(db);

      expect(verdictLog(db)).toEqual([
        {
          change: "existing",
          key: "m:501",
          previous_key: null,
          status: "wantlist",
          source: "seed:wantlist",
          notes: null,
        },
      ]);
      expect(trackMarkLog(db)).toEqual([
        { change: "existing", position: "B1", mark: "keep", notes: null, at_seconds: null },
      ]);
    } finally {
      fs.rmSync(early, { recursive: true, force: true });
    }
  });

  it("moves seed dates to UTC without logging the change as a decision", () => {
    const db = migrating();
    migrateTo(db, 14);
    db.prepare(
      `INSERT INTO verdicts (key, status, source, release_id, decided_at, dug_at) VALUES
         ('m:501', 'wantlist', 'seed:wantlist', 1001, '2026-09-22T14:48:52-07:00', NULL),
         ('m:502', 'collection', 'seed:collection', 1002, '2020-01-02', NULL),
         ('m:503', 'accepted', 'triage', 1003, '2026-09-28T10:00:00.000Z', '2026-09-28T10:00:00.000Z')`,
    ).run();
    const logged = verdictLog(db).length;
    migrateTo(db, 15);

    expect(db.prepare("SELECT key, decided_at FROM verdicts ORDER BY key").all()).toEqual([
      { key: "m:501", decided_at: "2026-09-22T21:48:52.000Z" },
      { key: "m:502", decided_at: "2020-01-02T00:00:00.000Z" },
      { key: "m:503", decided_at: "2026-09-28T10:00:00.000Z" },
    ]);
    expect(
      db.prepare("SELECT decided_at FROM verdict_log WHERE key = 'm:501'").pluck().all(),
    ).toEqual(["2026-09-22T21:48:52.000Z"]);
    expect(verdictLog(db)).toHaveLength(logged);
  });

  it("moves the account's items out of the verdicts, and brings back a want a seed replaced", () => {
    const db = migrating();
    migrateTo(db, 16);
    const at = "2026-09-20T10:00:00.000Z";
    db.prepare(
      `INSERT INTO verdicts (key, status, source, notes, release_id, decided_at, dug_at) VALUES
         ('m:501', 'accepted', 'triage', 'my note', 1001, '${at}', '${at}'),
         ('m:503', 'rejected', 'triage', 'too dark', 1003, '${at}', '${at}'),
         ('m:506', 'maybe', 'seed:list', 'check the flip', 1006, '${at}', NULL)`,
    ).run();
    // The wantlist import took the pushed want over, keeping its dug date.
    db.prepare(
      "UPDATE verdicts SET status = 'wantlist', source = 'seed:wantlist', decided_at = ? WHERE key = 'm:501'",
    ).run("2026-09-22T21:48:52.000Z");
    db.prepare(
      `INSERT INTO seed_items (kind, release_id, master_id, date_added, notes, basic_information_json,
         imported_at)
       VALUES ('wantlist', 1001, 501, '2026-09-22T14:48:52-07:00', 'repress', '{}', '${at}')`,
    ).run();
    const logged = verdictLog(db).length;
    applyMigrations(db);

    expect(db.prepare("SELECT * FROM verdicts ORDER BY key").all()).toEqual([
      { key: "m:501", status: "accepted", source: "triage", release_id: 1001, decided_at: at },
      { key: "m:503", status: "rejected", source: "triage", release_id: 1003, decided_at: at },
    ]);
    expect(
      db.prepare("SELECT kind, release_id, date_added, notes FROM memberships ORDER BY kind").all(),
    ).toEqual([
      { kind: "list", release_id: 1006, date_added: null, notes: "check the flip" },
      {
        kind: "wantlist",
        release_id: 1001,
        date_added: "2026-09-22T14:48:52-07:00",
        notes: "repress",
      },
    ]);
    expect(
      db.prepare("SELECT release_id, notes FROM release_notes ORDER BY release_id").all(),
    ).toEqual([
      { release_id: 1001, notes: "my note" },
      { release_id: 1003, notes: "too dark" },
      { release_id: 1006, notes: "check the flip" },
    ]);
    expect(verdictLog(db)).toHaveLength(logged);
  });
});
