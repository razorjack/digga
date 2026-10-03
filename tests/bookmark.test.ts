import { expect, it } from "vite-plus/test";
import { bookmarkedEntry } from "../src/client/player/bookmark.ts";
import { buildReleaseDetail } from "../src/server/queue/detail.ts";
import { fixtureDb } from "./helpers.ts";

it("can replay a saved upload missing from the catalogue without assigning it to a different tune", async () => {
  const db = await fixtureDb();
  const detail = buildReleaseDetail(db, 1001)!;
  const saved = bookmarkedEntry(detail, {
    releaseId: 1001,
    videoId: "missing0001",
    atSeconds: 37,
    tune: { heardKey: "missing", artistDisplay: "Artist", title: "Original tune" },
  });
  expect(saved.video.title).toBe("Original tune");
  expect(saved.video.videoId).toBe("missing0001");
  expect(saved.track).toBeNull();
  db.close();
});
