import { expect, it } from "vite-plus/test";
import { fixtureDb } from "./helpers.ts";
import { setTrackVerdict } from "../src/server/db/verdicts.ts";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import { listMarkedTracks } from "../src/server/queue/track-marks.ts";
import { listTrackMarkExports } from "../src/server/db/export.ts";
import { trackForMark } from "../src/shared/track-identity.ts";

it("follows a renamed position but preserves the original tune when a position is reused", async () => {
  const db = await fixtureDb();
  const original = buildReleaseDetail(db, 1001)!.tracks.find((track) => track.position === "A1")!;
  const saved = setTrackVerdict(db, { releaseId: 1001, position: "A1", mark: "keep" })!;
  db.prepare("UPDATE tracks SET position = 'A' WHERE release_id = 1001 AND position = 'A1'").run();
  const renamed = buildReleaseDetail(db, 1001)!;
  expect(renamed.tracks.find((track) => track.position === "A")?.mark).toBe("keep");
  expect(trackForMark(saved, renamed.tracks)?.position).toBe("A");
  db.prepare(
    "UPDATE tracks SET position = 'A1', title = 'Different tune', heard_key = 'different' WHERE release_id = 1001 AND position = 'A'",
  ).run();
  expect(
    buildReleaseDetail(db, 1001)!.tracks.find((track) => track.position === "A1")?.mark,
  ).toBeNull();
  setTrackVerdict(db, { releaseId: 1001, position: "A1", mark: "keep", notes: "Original tune" });
  expect(listMarkedTracks(db)[0]).toMatchObject({
    tracklistChanged: true,
    track: { title: original.title },
  });
  expect(listTrackMarkExports(db)[0]?.trackTitle).toBe(original.title);
  expect(() =>
    setTrackVerdict(db, {
      releaseId: 1001,
      position: "A1",
      mark: "candidate",
      tune: { heardKey: "different", artistDisplay: "Artist", title: "Different tune" },
    }),
  ).toThrow("different tune");
  expect(
    trackForMark(saved, [
      { position: "A", heardKey: saved.heardKey! },
      { position: "B", heardKey: saved.heardKey! },
    ]),
  ).toBeNull();
  db.close();
});
