import { describe, expect, it } from "vite-plus/test";
import { getMeta } from "../src/server/db/db.ts";
import { remapTuneKeys, rekeyTunes } from "../src/server/db/tune-keys.ts";
import { logListen, setTrackVerdict } from "../src/server/db/verdicts.ts";
import { fixtureDb, tuneAt } from "./helpers.ts";

const heardKeys = (db: Awaited<ReturnType<typeof fixtureDb>>) =>
  db.prepare("SELECT heard_key FROM heard_tracks ORDER BY heard_key").pluck().all();
const trackKey = (db: Awaited<ReturnType<typeof fixtureDb>>, releaseId: number, position: string) =>
  db
    .prepare("SELECT heard_key FROM tracks WHERE release_id = ? AND position = ?")
    .pluck()
    .get(releaseId, position);

describe("tune keys", () => {
  it("rekeys a library keyed by older rules once, and listens and marks follow their tracks", async () => {
    const db = await fixtureDb();
    logListen(db, { releaseId: 1006, position: "A", videoId: "dddddddddd1", seconds: 12 });
    setTrackVerdict(db, {
      releaseId: 1001,
      position: "B1",
      tune: tuneAt(db, 1001, "B1"),
      mark: "keep",
    });
    setTrackVerdict(db, {
      releaseId: 1001,
      position: "A1",
      tune: tuneAt(db, 1001, "A1"),
      mark: "meh",
    });
    // As the older rules keyed them: by the credited name, without the (n) suffix.
    db.exec(`UPDATE tracks SET heard_key = 'old ' || heard_key;
      UPDATE listen_log SET heard_key = 'konflikt - messiah';
      UPDATE heard_tracks SET heard_key = 'konflikt - messiah';
      UPDATE track_verdicts SET heard_key = 'old ' || heard_key;
      UPDATE track_verdicts SET title = 'Another tune' WHERE position = 'A1';
      DELETE FROM meta WHERE key = 'tune_key_version'`);
    const markLog = () => db.prepare("SELECT COUNT(*) FROM track_mark_log").pluck().get();
    const logged = markLog();

    rekeyTunes(db);

    expect(trackKey(db, 1006, "A")).toBe("konflict - messiah");
    expect(db.prepare("SELECT heard_key FROM listen_log").pluck().all()).toEqual([
      "konflict - messiah",
    ]);
    expect(heardKeys(db)).toEqual(["konflict - messiah"]);
    expect(
      db.prepare("SELECT position, heard_key FROM track_verdicts ORDER BY position").all(),
    ).toEqual([
      { position: "A1", heard_key: "old ed rush 2 and optical - wormhole" },
      { position: "B1", heard_key: "ed rush 2 and optical - watermelon" },
    ]);
    expect(markLog()).toBe(logged);
    expect(getMeta(db, "tune_key_version")).toBe("2");

    db.exec("UPDATE tracks SET heard_key = 'kept'");
    rekeyTunes(db);
    expect(trackKey(db, 1006, "A")).toBe("kept");
    db.close();
  });

  it("follows a tune keyed by its record to the master its release moved to", async () => {
    const db = await fixtureDb();
    db.exec(`UPDATE tracks SET heard_key = 'r:1006 A' WHERE release_id = 1006`);
    logListen(db, { releaseId: 1006, position: "A", videoId: "dddddddddd1", seconds: 12 });
    expect(heardKeys(db)).toEqual(["r:1006 A"]);

    db.exec(`UPDATE tracks SET heard_key = 'm:900 A' WHERE release_id = 1006`);
    remapTuneKeys(db);

    expect(heardKeys(db)).toEqual(["m:900 A"]);
    db.close();
  });
});
