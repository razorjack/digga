import { expect, it } from "vite-plus/test";
import { logListen } from "../src/server/db/verdicts.ts";
import { readBackedUpData, restoreBackedUpData } from "../src/server/db/user-data.ts";
import { fixtureDb } from "./helpers.ts";

it("preserves the heard tune and sampled offsets when the catalogue changes", async () => {
  const db = await fixtureDb();
  const context = {
    playbackId: "cc9f7741-9dca-42c7-a252-100000000001",
    sessionId: null,
    startedAt: "2026-10-03T12:00:00.000Z",
    startSeconds: 92,
    endSeconds: 96,
    videoTitle: "Original upload",
    tune: { heardKey: "original - tune", artistDisplay: "Original", title: "Tune" },
  };
  db.prepare(
    "UPDATE tracks SET title = 'Different tune', heard_key = 'different' WHERE release_id = 1001",
  ).run();
  const result = logListen(db, {
    releaseId: 1001,
    position: "A1",
    videoId: "video",
    seconds: 4,
    context,
  });
  expect(result.heardKey).toBe("original - tune");
  expect(readBackedUpData(db).listenLog[0]).toMatchObject({
    heard_key: "original - tune",
    title: "Tune",
    artist_display: "Original",
    start_seconds: 92,
    end_seconds: 96,
    playback_id: context.playbackId,
    video_title: "Original upload",
    heard: 1,
  });
  const restored = await fixtureDb();
  restoreBackedUpData(restored, readBackedUpData(db), "2099-01-01T00:00:00Z");
  expect(readBackedUpData(restored).listenLog).toEqual(readBackedUpData(db).listenLog);
  db.close();
  restored.close();
});
