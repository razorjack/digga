import { describe, expect, it } from "vite-plus/test";
import { getMeta } from "../src/server/db/db.ts";
import { addUserVideo } from "../src/server/db/releases.ts";
import { rematchVideos } from "../src/server/db/video-matches.ts";
import { logListen, setTrackVerdict, upsertVerdict } from "../src/server/db/verdicts.ts";
import { fixtureDb, tuneAt } from "./helpers.ts";

type FixtureDb = Awaited<ReturnType<typeof fixtureDb>>;

const matchedPosition = (db: FixtureDb, table: string, videoId: string) =>
  db.prepare(`SELECT matched_position FROM ${table} WHERE video_id = ?`).pluck().get(videoId);

const decisions = (db: FixtureDb) => ({
  verdicts: db.prepare("SELECT * FROM verdicts ORDER BY key").all(),
  marks: db.prepare("SELECT * FROM track_verdicts ORDER BY release_id, position").all(),
  listens: db.prepare("SELECT * FROM listen_log ORDER BY id").all(),
  heard: db.prepare("SELECT * FROM heard_tracks ORDER BY heard_key").all(),
});

describe("video matches", () => {
  it("rematches a library matched by older rules once, and leaves the decisions alone", async () => {
    const db = await fixtureDb();
    upsertVerdict(db, { key: "m:501", status: "accepted", source: "triage" });
    setTrackVerdict(db, {
      releaseId: 1001,
      position: "A1",
      tune: tuneAt(db, 1001, "A1"),
      mark: "keep",
    });
    logListen(db, { releaseId: 1006, position: "A", videoId: "dddddddddd1", seconds: 12 });
    addUserVideo(db, 1006, {
      videoId: "uuuuuuuuuu1",
      src: "https://www.youtube.com/watch?v=uuuuuuuuuu1",
      title: "Konflikt - Beck-oning",
      matchedPosition: null,
    });
    // As the older rules left them: neither title matches its track with the spaces in place.
    db.exec(`UPDATE videos SET title = 'Optical - Water Melon', matched_position = NULL
        WHERE video_id = 'aaaaaaaaaa2';
      DELETE FROM meta WHERE key = 'video_match_version'`);
    const before = decisions(db);

    rematchVideos(db);

    expect(matchedPosition(db, "videos", "aaaaaaaaaa2")).toBe("B1");
    expect(matchedPosition(db, "videos", "aaaaaaaaaa1")).toBe("A1");
    expect(matchedPosition(db, "videos", "dddddddddd2")).toBeNull();
    expect(matchedPosition(db, "user_videos", "uuuuuuuuuu1")).toBe("AA");
    expect(decisions(db)).toEqual(before);
    expect(getMeta(db, "video_match_version")).toBe("2");

    db.exec("UPDATE videos SET matched_position = NULL WHERE video_id = 'aaaaaaaaaa2'");
    rematchVideos(db);
    expect(matchedPosition(db, "videos", "aaaaaaaaaa2")).toBeNull();
    db.close();
  });
});
