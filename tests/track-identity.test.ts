import { expect, it } from "vite-plus/test";
import { fixtureDb, tuneAt } from "./helpers.ts";
import { getTrackVerdicts, setTrackVerdict } from "../src/server/db/verdicts.ts";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import { listMarkedTracks } from "../src/server/queue/track-marks.ts";
import { listTrackMarkExports } from "../src/server/db/export.ts";
import { trackForMark } from "../src/shared/track-identity.ts";

it("keeps a mark with its tune when the position is renamed, and apart from a tune reusing it", async () => {
  const db = await fixtureDb();
  const original = tuneAt(db, 1001, "A1");
  const saved = setTrackVerdict(db, {
    releaseId: 1001,
    position: "A1",
    tune: original,
    mark: "keep",
  })!;
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
  expect(listMarkedTracks(db)[0]).toMatchObject({
    tracklistChanged: true,
    track: { title: original.title },
  });
  expect(listTrackMarkExports(db)[0]?.trackTitle).toBe(original.title);

  setTrackVerdict(db, {
    releaseId: 1001,
    position: "A1",
    tune: { heardKey: "different", artistDisplay: "Artist", title: "Different tune" },
    mark: "candidate",
  });
  expect(getTrackVerdicts(db, 1001).map(({ heardKey, mark }) => [heardKey, mark])).toEqual([
    ["different", "candidate"],
    [original.heardKey, "keep"],
  ]);
  db.close();
});

it("marks tunes without a position apart, and finds a tune listed twice at the mark's position", async () => {
  const db = await fixtureDb();
  for (const title of ["This Side", "Other Side"])
    setTrackVerdict(db, {
      releaseId: 1001,
      position: "",
      tune: { heardKey: `artist - ${title.toLowerCase()}`, artistDisplay: "Artist", title },
      mark: "keep",
    });
  expect(getTrackVerdicts(db, 1001)).toHaveLength(2);

  const twice = [
    { position: "A", heardKey: "tune" },
    { position: "B", heardKey: "tune" },
  ];
  expect(trackForMark({ position: "B", heardKey: "tune" }, twice)).toBe(twice[1]);
  expect(trackForMark({ position: "C", heardKey: "tune" }, twice)).toBe(twice[0]);
  expect(trackForMark({ position: "A", heardKey: "gone" }, twice)).toBeNull();
  db.close();
});
