import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "../src/server/db/db.ts";
import { addUserVideo } from "../src/server/db/releases.ts";
import { readBackedUpData, restoreBackedUpData } from "../src/server/db/user-data.ts";
import {
  getVerdict,
  logListen,
  setTrackVerdict,
  upsertVerdict,
} from "../src/server/db/verdicts.ts";
import {
  backupDecisionsDaily,
  listDecisionsBackups,
  readDecisionsBackup,
  writeDecisionsBackup,
} from "../src/server/decisions-backup.ts";
import { recordNoAudioVideos } from "../src/server/queue/no-audio.ts";
import { fixtureDb } from "./helpers.ts";

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
    notes: "the Kool FM tune",
    releaseId: 1001,
    decidedAt: "2026-09-01T10:00:00.000Z",
  });
  upsertVerdict(db, {
    key: "m:506",
    status: "no_audio",
    source: "triage",
    releaseId: 1006,
    decidedAt: "2026-09-02T10:00:00.000Z",
  });
  recordNoAudioVideos(db, getVerdict(db, "m:506")!);
  upsertVerdict(db, {
    key: "r:4242",
    status: "wantlist",
    source: "seed:wantlist",
    releaseId: 4242,
    decidedAt: "2026-08-01T09:02:08-07:00",
  });
  setTrackVerdict(db, {
    releaseId: 1001,
    position: "A1",
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

describe("the decisions backup", () => {
  it("brings everything back into a library loaded from a dump", async () => {
    const source = await libraryWithDecisions();
    const written = await writeDecisionsBackup(source, on("2026-09-10"));
    const backup = readDecisionsBackup(written.file);
    const target = await fixtureDb();

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(outcome).toEqual({
      verdicts: { restored: 3, keptNewer: 0 },
      trackMarks: { restored: 1, keptNewer: 0 },
      heardTunes: { added: 1 },
      attachedVideos: { added: 1, withoutRelease: 0 },
    });
    expect(readBackedUpData(target)).toEqual(readBackedUpData(source));
    source.close();
    target.close();
  });

  it("keeps what was decided here after the backup, and replaces seeds and older decisions", async () => {
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
    setTrackVerdict(target, { releaseId: 1001, position: "A1", mark: "keep" });

    const outcome = restoreBackedUpData(target, backup, backup.backedUpAt);

    expect(getVerdict(target, "m:501")?.status).toBe("rejected");
    expect(getVerdict(target, "m:506")?.status).toBe("no_audio");
    expect(outcome.verdicts).toEqual({ restored: 2, keptNewer: 1 });
    expect(outcome.trackMarks).toEqual({ restored: 0, keptNewer: 1 });
    expect(outcome.attachedVideos).toEqual({ added: 1, withoutRelease: 1 });
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

  it("writes one entry per line, fields in a fixed order, gzipped", async () => {
    const db = await libraryWithDecisions();
    const written = await writeDecisionsBackup(db, on("2026-09-10"));
    const lines = zlib.gunzipSync(fs.readFileSync(written.file)).toString("utf8").split("\n");

    expect(path.basename(written.file)).toBe("decisions-2026-09-10.json.gz");
    expect(lines.slice(0, 6)).toEqual([
      "{",
      '  "app": "digga",',
      '  "kind": "decisions",',
      '  "version": 1,',
      '  "backedUpAt": "2026-09-10T12:00:00.000Z",',
      '  "verdicts": [',
    ]);
    expect(lines).toContain(
      '    {"key":"m:501","status":"candidate","source":"triage","notes":"the Kool FM tune","releaseId":1001,"decidedAt":"2026-09-01T10:00:00.000Z","dugAt":"2026-09-01T10:00:00.000Z"},',
    );
    db.close();
  });

  it("refuses a file that is not a decisions backup", () => {
    const file = path.join(dir, "decisions.json");
    fs.writeFileSync(file, JSON.stringify({ app: "digga", exportedAt: "now", verdicts: [] }));
    expect(() => readDecisionsBackup(file)).toThrow("is not a Digga decisions backup");
  });
});

describe("the daily decisions backup", () => {
  it("writes nothing for a library with nothing made in Digga", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "r:4242", status: "wantlist", source: "seed:wantlist" });
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
