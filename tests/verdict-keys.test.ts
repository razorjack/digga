import { afterEach, describe, expect, it } from "vite-plus/test";
import { loadDump } from "../tools/dump/load.ts";
import type { Db } from "../src/server/db/db.ts";
import { restoreBackedUpData } from "../src/server/db/user-data.ts";
import { moveVerdictsToReleaseKeys } from "../src/server/db/verdict-keys.ts";
import { getVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { FIXTURE_GZ, fixtureDb } from "./helpers.ts";

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

async function library(): Promise<Db> {
  const db = await fixtureDb();
  opened.push(db);
  return db;
}

/** Loads the fixture dump again, as the next monthly dump would. */
async function reload(db: Db): Promise<void> {
  await loadDump(db, { file: FIXTURE_GZ, styles: ["Drum n Bass"], loadYears: null });
}

function noAudioVideos(db: Db): { key: string; video_ids_json: string }[] {
  return db.prepare("SELECT key, video_ids_json FROM no_audio_videos ORDER BY key").all() as {
    key: string;
    video_ids_json: string;
  }[];
}

describe("verdicts when a dump load changes a release's key", () => {
  it("follow the release to the master Discogs gave it", async () => {
    const db = await library();
    // 1001 is on master 501 in the fixture; the verdict was given when it had no master.
    upsertVerdict(db, {
      key: "r:1001",
      status: "rejected",
      source: "triage",
      releaseId: 1001,
      notes: "too dark",
      decidedAt: "2026-10-03T10:00:00.000Z",
    });

    await reload(db);

    expect(getVerdict(db, "r:1001")).toBeNull();
    expect(getVerdict(db, "m:501")).toMatchObject({
      status: "rejected",
      source: "triage",
      releaseId: 1001,
      notes: "too dark",
      decidedAt: "2026-10-03T10:00:00.000Z",
      dugAt: "2026-10-03T10:00:00.000Z",
    });
    expect(
      db
        .prepare("SELECT change, key, previous_key FROM verdict_log ORDER BY id DESC LIMIT 1")
        .get(),
    ).toEqual({ change: "update", key: "m:501", previous_key: "r:1001" });
  });

  it("take the videos a no-audio record had along", async () => {
    const db = await library();
    upsertVerdict(db, { key: "r:1006", status: "no_audio", source: "triage", releaseId: 1006 });
    db.prepare(
      "INSERT INTO no_audio_videos (key, video_ids_json) VALUES ('r:1006', '[\"x\"]')",
    ).run();

    await reload(db);

    expect(getVerdict(db, "m:506")?.status).toBe("no_audio");
    expect(noAudioVideos(db)).toEqual([{ key: "m:506", video_ids_json: '["x"]' }]);
  });

  it("merge with a verdict the record has: the higher rank stays, with both notes", async () => {
    const db = await library();
    upsertVerdict(db, {
      key: "r:1002",
      status: "accepted",
      source: "triage",
      releaseId: 1002,
      notes: "the B side",
      decidedAt: "2026-10-03T10:00:00.000Z",
    });
    upsertVerdict(db, {
      key: "m:501",
      status: "rejected",
      source: "triage",
      releaseId: 1001,
      notes: "too dark",
      decidedAt: "2026-10-04T10:00:00.000Z",
    });

    await reload(db);

    expect(getVerdict(db, "r:1002")).toBeNull();
    expect(getVerdict(db, "m:501")).toMatchObject({
      status: "accepted",
      releaseId: 1002,
      notes: "the B side; too dark",
      decidedAt: "2026-10-03T10:00:00.000Z",
      dugAt: "2026-10-04T10:00:00.000Z",
    });
  });

  it("keep apart when two releases swap masters", async () => {
    const db = await library();
    upsertVerdict(db, { key: "m:501", status: "candidate", source: "triage", releaseId: 1001 });
    upsertVerdict(db, { key: "m:506", status: "no_audio", source: "triage", releaseId: 1006 });
    db.prepare(
      "INSERT INTO no_audio_videos (key, video_ids_json) VALUES ('m:506', '[\"x\"]')",
    ).run();
    // As a load that finds Discogs moved each release to the other's master would leave them.
    db.prepare("UPDATE releases SET master_id = 506, triage_key = 'm:506' WHERE id = 1001").run();
    db.prepare("UPDATE releases SET master_id = 501, triage_key = 'm:501' WHERE id = 1006").run();

    expect(moveVerdictsToReleaseKeys(db, [1001, 1006])).toBe(2);

    expect(getVerdict(db, "m:506")).toMatchObject({ status: "candidate", releaseId: 1001 });
    expect(getVerdict(db, "m:501")).toMatchObject({ status: "no_audio", releaseId: 1006 });
    expect(noAudioVideos(db)).toEqual([{ key: "m:501", video_ids_json: '["x"]' }]);
  });

  it("merge every verdict arriving at one key, keeping the strongest", async () => {
    const db = await library();
    upsertVerdict(db, { key: "r:1001", status: "rejected", source: "triage", releaseId: 1001 });
    upsertVerdict(db, { key: "r:1002", status: "candidate", source: "triage", releaseId: 1002 });

    expect(moveVerdictsToReleaseKeys(db, [1001, 1002])).toBe(2);

    expect(getVerdict(db, "m:501")).toMatchObject({ status: "candidate", releaseId: 1002 });
    expect(db.prepare("SELECT COUNT(*) FROM verdicts").pluck().get()).toBe(1);
  });

  it("leave a release that lost its master as a record of its own", async () => {
    const db = await library();
    upsertVerdict(db, { key: "m:999", status: "maybe", source: "triage", releaseId: 1003 });
    upsertVerdict(db, { key: "m:777", status: "seen", source: "seed:history" });

    await reload(db);

    expect(getVerdict(db, "r:1003")?.status).toBe("maybe");
    expect(getVerdict(db, "m:999")).toBeNull();
    expect(getVerdict(db, "m:777")?.status).toBe("seen");
  });

  it("are restored on the record their release is on now", async () => {
    const db = await library();
    const verdict = {
      key: "r:1001",
      status: "candidate",
      source: "triage",
      notes: null,
      releaseId: 1001,
      decidedAt: "2026-09-01T10:00:00.000Z",
      dugAt: "2026-09-01T10:00:00.000Z",
    } as const;

    const outcome = restoreBackedUpData(
      db,
      {
        verdicts: [verdict],
        trackMarks: [],
        heardTunes: [],
        attachedVideos: [],
        noAudioVideos: [],
        releaseNotes: [],
        listenLog: [],
        verdictLog: [],
        trackMarkLog: [],
        sessions: [],
      },
      "2026-09-02T00:00:00.000Z",
    );

    expect(outcome.verdicts).toEqual({ restored: 1, keptNewer: 0, moved: 1 });
    expect(getVerdict(db, "m:501")?.status).toBe("candidate");
    expect(getVerdict(db, "r:1001")).toBeNull();
  });
});
