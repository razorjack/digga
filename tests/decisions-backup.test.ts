import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { recordMembership, recordMembershipOf } from "../src/server/db/memberships.ts";
import { releaseNote, saveReleaseNote } from "../src/server/db/notes.ts";
import { addUserVideo } from "../src/server/db/releases.ts";
import { readBackedUpData, restoreBackedUpData } from "../src/server/db/user-data.ts";
import {
  deleteVerdict,
  getTrackVerdicts,
  getVerdict,
  logListen,
  setTrackVerdict,
  upsertVerdict,
} from "../src/server/db/verdicts.ts";
import {
  backupDecisionsDaily,
  formatDecisionsBackup,
  listDecisionsBackups,
  readDecisionsBackup,
  writeDecisionsBackup,
} from "../src/server/decisions-backup.ts";
import { recordNoAudioVideos } from "../src/server/queue/no-audio.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import { fixtureDb, tuneAt } from "./helpers.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "digga-decisions-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The fixture library with one of everything the decisions backup holds. */
async function libraryWithDecisions(): Promise<Db> {
  const db = await fixtureDb();
  upsertVerdict(db, {
    key: "m:501",
    status: "candidate",
    source: "triage",
    releaseId: 1001,
    decidedAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  });
  saveReleaseNote(db, 1001, "the Kool FM tune");
  upsertVerdict(db, {
    key: "m:506",
    status: "no_audio",
    source: "triage",
    releaseId: 1006,
    decidedAt: "2026-09-02T10:00:00.000Z",
  });
  recordNoAudioVideos(db, getVerdict(db, "m:506")!);
  recordMembership(db, { ...WANT_4242, dateAdded: "2026-08-01T09:02:08-07:00" });
  setTrackVerdict(db, {
    releaseId: 1001,
    position: "A1",
    tune: tuneAt(db, 1001, "A1"),
    mark: "candidate",
    notes: "at 3:10",
    videoId: "aaaaaaaaaa1",
    atSeconds: 190.5,
  });
  logListen(db, { releaseId: 1001, position: "A1", videoId: "aaaaaaaaaa1", seconds: 12 });
  addUserVideo(db, 1006, {
    videoId: "pastedvid01",
    src: "https://www.youtube.com/watch?v=pastedvid01",
    title: "Konflict - Messiah",
    matchedPosition: "A",
  });
  return db;
}

const on = (day: string) => ({ dir, day, now: new Date(`${day}T12:00:00.000Z`) });

const WANT_4242 = {
  kind: "wantlist",
  releaseId: 4242,
  masterId: null,
  dateAdded: null,
  rating: null,
  notes: null,
} as const;

describe("the decisions backup", () => {
  it("brings everything back into a library loaded from a dump", async () => {
    const source = await libraryWithDecisions();
    const written = await writeDecisionsBackup(source, on("2026-09-10"));
    const backup = readDecisionsBackup(written.file);
    const target = await fixtureDb();

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(outcome).toEqual({
      verdicts: { restored: 2, keptNewer: 0, moved: 0 },
      memberships: { restored: 1 },
      trackMarks: { restored: 1, keptNewer: 0 },
      heardTunes: { added: 1 },
      attachedVideos: { added: 1 },
      sessions: { restored: 0, leftOut: 0 },
    });
    expect(readBackedUpData(target)).toEqual(readBackedUpData(source));
    source.close();
    target.close();
  });

  it("merges overlapping history backups without duplicating events", async () => {
    const source = await libraryWithDecisions();
    const first = readBackedUpData(source);
    const target = await fixtureDb();
    restoreBackedUpData(target, first, "2026-09-10T12:00:00Z");
    logListen(source, { releaseId: 1001, position: "A1", videoId: "a", seconds: 2, heard: false });
    const second = readBackedUpData(source);
    restoreBackedUpData(target, second, "2099-01-01T00:00:00Z");
    restoreBackedUpData(target, second, "2099-01-01T00:00:00Z");
    expect(readBackedUpData(target)).toEqual(second);
    source.close();
    target.close();
  });

  it("keeps an independent note edited after the backup without changing the verdict date", async () => {
    const source = await libraryWithDecisions();
    const backup = readBackedUpData(source);
    const target = await fixtureDb();
    restoreBackedUpData(target, backup, "2026-09-10T12:00:00Z");
    const decidedAt = getVerdict(target, "m:501")?.decidedAt;
    saveReleaseNote(target, 1001, "newer independent note");
    restoreBackedUpData(target, backup, "2026-09-10T12:00:00Z");
    expect(releaseNote(target, 1001)).toBe("newer independent note");
    expect(getVerdict(target, "m:501")?.decidedAt).toBe(decidedAt);
    source.close();
    target.close();
  });

  it("includes settings without the saved token", async () => {
    const db = await fixtureDb();
    const config = structuredClone(DEFAULT_CONFIG);
    config.filters.excludeLabels = [{ id: 7, name: "Hidden label" }];
    const written = await writeDecisionsBackup(db, { ...on("2026-09-10"), config });
    expect(readDecisionsBackup(written.file).config).toEqual(config);
    db.close();
  });

  it("keeps what was decided here after the backup, and replaces history hits and older decisions", async () => {
    const source = await libraryWithDecisions();
    const backup = readDecisionsBackup((await writeDecisionsBackup(source, on("2026-09-10"))).file);
    backup.attachedVideos.push({ ...backup.attachedVideos[0]!, releaseId: 999_999 });
    const target = await fixtureDb();
    upsertVerdict(target, {
      key: "m:501",
      status: "rejected",
      source: "triage",
      releaseId: 1001,
      decidedAt: "2026-09-20T10:00:00.000Z",
    });
    upsertVerdict(target, {
      key: "m:506",
      status: "seen",
      source: "seed:history",
      releaseId: 1006,
    });
    setTrackVerdict(target, {
      releaseId: 1001,
      position: "A1",
      tune: tuneAt(target, 1001, "A1"),
      mark: "keep",
    });

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(getVerdict(target, "m:501")?.status).toBe("rejected");
    expect(getVerdict(target, "m:506")?.status).toBe("no_audio");
    expect(outcome.verdicts).toEqual({ restored: 1, keptNewer: 1, moved: 0 });
    expect(outcome.memberships).toEqual({ restored: 1 });
    expect(outcome.trackMarks).toEqual({ restored: 0, keptNewer: 1 });
    expect(outcome.attachedVideos).toEqual({ added: 2 });
    expect(
      target.prepare("SELECT 1 FROM user_videos WHERE release_id = 999999").get(),
    ).toBeTruthy();
    source.close();
    target.close();
  });

  it("reads a track mark from before marks kept their tune and moment", () => {
    const file = path.join(dir, "decisions-2026-09-01.json");
    const mark = { releaseId: 1001, position: "A1", mark: "keep", notes: null };
    const backup = {
      app: "digga",
      kind: "decisions",
      version: 1,
      backedUpAt: "2026-09-01T12:00:00.000Z",
      verdicts: [],
      trackMarks: [{ ...mark, decidedAt: "2026-09-01T10:00:00.000Z" }],
      heardTunes: [],
      attachedVideos: [],
      noAudioVideos: [],
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(backup));

    expect(readDecisionsBackup(file).trackMarks[0]).toMatchObject({
      heardKey: null,
      videoId: null,
      atSeconds: null,
    });
  });

  it("writes a header, then one camelCase record per line in a fixed field order, gzipped", async () => {
    const db = await libraryWithDecisions();
    const written = await writeDecisionsBackup(db, on("2026-09-10"));
    const lines = zlib.gunzipSync(fs.readFileSync(written.file)).toString("utf8").split("\n");

    expect(path.basename(written.file)).toBe("decisions-2026-09-10.json.gz");
    expect(JSON.parse(lines[0]!)).toEqual({
      app: "digga",
      kind: "decisions",
      version: 3,
      backedUpAt: "2026-09-10T12:00:00.000Z",
      dataHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      config: null,
    });
    expect(lines).toContain(
      '{"record":"verdict","key":"m:501","status":"candidate","source":"triage","releaseId":1001,"decidedAt":"2026-09-01T10:00:00.000Z","updatedAt":"2026-09-01T10:00:00.000Z"}',
    );
    const listen = lines.find((line) => line.startsWith('{"record":"listen"'));
    expect(Object.keys(JSON.parse(listen!))).toContain("releaseId");
    db.close();
  });

  it("reads a version 2 document, and skips a daily backup when the data hash says nothing changed", async () => {
    const db = await libraryWithDecisions();
    const backup = readDecisionsBackup((await writeDecisionsBackup(db, on("2026-09-10"))).file);
    const older = path.join(dir, "decisions-2026-09-09.json");
    fs.writeFileSync(older, JSON.stringify({ ...backup, version: 2 }, null, 2));
    expect(readDecisionsBackup(older).verdicts).toEqual(backup.verdicts);

    expect(await backupDecisionsDaily(db, on("2026-09-11"))).toBeNull();
    upsertVerdict(db, { key: "m:503", status: "maybe", source: "triage", releaseId: 1003 });
    expect(await backupDecisionsDaily(db, on("2026-09-12"))).not.toBeNull();
    db.close();
  });

  it("restores the decisions when this version cannot read the settings or a session", async () => {
    const source = await libraryWithDecisions();
    const backup = readDecisionsBackup((await writeDecisionsBackup(source, on("2026-09-10"))).file);
    const file = path.join(dir, "older.json");
    fs.writeFileSync(
      file,
      formatDecisionsBackup({
        ...backup,
        config: { queue: { strategy: "removed-strategy" } },
        sessions: [
          {
            id: "bb8f7741-9dca-42c7-a252-100000000009",
            started_at: "2026-09-09T10:00:00.000Z",
            updated_at: "2026-09-09T11:00:00.000Z",
            config_json: JSON.stringify({ queue: { strategy: "removed-strategy" } }),
            dump_date: null,
            schema_version: 14,
            state_json: "{}",
          },
        ],
      }),
    );
    const target = await fixtureDb();

    const outcome = restoreBackedUpData(target, readDecisionsBackup(file), backup.backedUpAt);

    expect(outcome.verdicts.restored).toBe(2);
    expect(outcome.sessions).toEqual({ restored: 0, leftOut: 1 });
    source.close();
    target.close();
  });

  it("turns the seed verdicts and verdict notes of a version 2 backup into memberships and notes", async () => {
    const file = path.join(dir, "decisions-2026-09-10.json");
    const seed = { releaseId: 1006, decidedAt: "2026-08-01T09:02:08-07:00", dugAt: null };
    fs.writeFileSync(
      file,
      JSON.stringify({
        app: "digga",
        kind: "decisions",
        version: 2,
        backedUpAt: "2026-09-10T12:00:00.000Z",
        verdicts: [
          { ...seed, key: "m:506", status: "wantlist", source: "seed:wantlist", notes: null },
          {
            key: "m:501",
            status: "accepted",
            source: "triage",
            notes: "the Kool FM tune",
            releaseId: 1001,
            decidedAt: "2026-09-01T10:00:00.000Z",
            dugAt: "2026-09-01T10:00:00.000Z",
          },
        ],
        trackMarks: [],
        heardTunes: [],
        attachedVideos: [],
        noAudioVideos: [],
      }),
    );
    const backup = readDecisionsBackup(file);
    const target = await fixtureDb();

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(outcome.verdicts.restored).toBe(1);
    expect(outcome.memberships).toEqual({ restored: 1 });
    expect(getVerdict(target, "m:506")).toBeNull();
    expect(recordMembershipOf(target, "m:506").onWantlist).toBe(true);
    expect(releaseNote(target, 1001)).toBe("the Kool FM tune");
    target.close();
  });

  it("says when a newer Digga wrote the backup", () => {
    const file = path.join(dir, "decisions-2030-01-01.json");
    fs.writeFileSync(file, JSON.stringify({ app: "digga", kind: "decisions", version: 99 }));
    expect(() => readDecisionsBackup(file)).toThrow("written by a newer Digga (backup format 99)");
  });

  it("refuses a file that is not a decisions backup", () => {
    const file = path.join(dir, "decisions.json");
    fs.writeFileSync(file, JSON.stringify({ app: "digga", exportedAt: "now", verdicts: [] }));
    expect(() => readDecisionsBackup(file)).toThrow("is not a Digga decisions backup");
  });
});

describe("restoring into a library that changed since the backup", () => {
  const LONG_AGO = "2020-01-01T00:00:00.000Z";

  it("keeps a mark's note edited, and a verdict deleted, after the backup", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, {
      key: "m:501",
      status: "candidate",
      source: "triage",
      releaseId: 1001,
      decidedAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });
    const tune = tuneAt(db, 1001, "A1");
    setTrackVerdict(db, { releaseId: 1001, position: "A1", tune, mark: "keep", notes: "old note" });
    db.prepare("UPDATE track_verdicts SET decided_at = ?, updated_at = ?").run(LONG_AGO, LONG_AGO);
    const backup = readDecisionsBackup((await writeDecisionsBackup(db, on("2026-09-10"))).file);

    setTrackVerdict(db, { releaseId: 1001, position: "A1", tune, mark: "keep", notes: "new note" });
    deleteVerdict(db, "m:501");
    const outcome = restoreBackedUpData(db, backup, backup.backedUpAt);

    expect(getTrackVerdicts(db, 1001).map((mark) => mark.notes)).toEqual(["new note"]);
    expect(getVerdict(db, "m:501")).toBeNull();
    expect(outcome.verdicts).toEqual({ restored: 0, keptNewer: 1, moved: 0 });
    expect(outcome.trackMarks).toEqual({ restored: 0, keptNewer: 1 });
    db.close();
  });

  it("keeps the grail when backed-up verdicts meet on one record", async () => {
    const source = await fixtureDb();
    const backup = readDecisionsBackup((await writeDecisionsBackup(source, on("2026-09-10"))).file);
    // Two pressings of master 501, decided apart under release keys before the master was known.
    backup.verdicts = [
      {
        key: "r:1001",
        status: "candidate",
        source: "triage",
        releaseId: 1001,
        decidedAt: LONG_AGO,
      },
      {
        key: "r:1002",
        status: "rejected",
        source: "triage",
        releaseId: 1002,
        decidedAt: "2021-01-01T00:00:00.000Z",
      },
    ];
    const target = await fixtureDb();

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(getVerdict(target, "m:501")).toMatchObject({ status: "candidate", releaseId: 1001 });
    expect(outcome.verdicts).toEqual({ restored: 1, keptNewer: 0, moved: 1 });
    source.close();
    target.close();
  });
});

describe("the daily decisions backup", () => {
  it("writes nothing for a library with nothing made in Digga", async () => {
    const db = await fixtureDb();
    recordMembership(db, WANT_4242);
    expect(await backupDecisionsDaily(db, on("2026-09-10"))).toBeNull();
    expect(listDecisionsBackups(dir)).toEqual([]);
    db.close();
  });

  it("writes once a day, only when something changed, and keeps the newest", async () => {
    const db = await libraryWithDecisions();
    const days = () => listDecisionsBackups(dir).map((backup) => backup.day);

    expect(await backupDecisionsDaily(db, { ...on("2026-09-10"), keep: 2 })).not.toBeNull();
    expect(await backupDecisionsDaily(db, { ...on("2026-09-10"), keep: 2 })).toBeNull();
    expect(await backupDecisionsDaily(db, { ...on("2026-09-11"), keep: 2 })).toBeNull();

    upsertVerdict(db, { key: "m:506", status: "rejected", source: "triage", releaseId: 1006 });
    await backupDecisionsDaily(db, { ...on("2026-09-12"), keep: 2 });
    upsertVerdict(db, { key: "m:503", status: "snoozed", source: "triage" });
    await backupDecisionsDaily(db, { ...on("2026-09-13"), keep: 2 });

    expect(days()).toEqual(["2026-09-13", "2026-09-12"]);
    db.close();
  });
});
