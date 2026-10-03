import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { FIRST_RECORD, SECOND_RECORD } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

test(
  "TWL-22 replay opens a marked upload at its saved second and leaves the verdict unchanged",
  { tag: ["@TWL-22", "@P1"] },
  async ({ app }) => {
    const track = FIRST_RECORD.tracks[1]!;
    const video = FIRST_RECORD.videos[1]!;
    const key = `m:${FIRST_RECORD.master!.id}`;
    await app.given.verdict({ key, releaseId: FIRST_RECORD.id, status: "accepted" });
    await app.given.trackMark({
      releaseId: FIRST_RECORD.id,
      position: track.position,
      mark: "keep",
      videoId: video.id,
      atSeconds: 37,
    });
    const triage = new TriagePage(app);
    const twelves = new TwelvesPage(app);
    await app.open();
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));
    await new HeaderPage(app).goTo("twelves");
    await twelves.showShelf("tracks");
    await expect(twelves.selected).toHaveAttribute("data-position", track.position);
    await twelves.replaySelected(FIRST_RECORD.id);
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await expect(triage.currentTrack).toHaveAttribute("data-position", track.position);
    await expect
      .poll(() => app.youtube.loads())
      .toContainEqual(expect.objectContaining({ videoId: video.id, startSeconds: 37 }));
    await triage.leaveRound();
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));
    expect(
      (await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`)).verdict?.status,
    ).toBe("accepted");
  },
);

test(
  "TWL-23 replay seeks the saved track even when its release is already on the triage desk",
  { tag: ["@TWL-23", "@P1"] },
  async ({ app }) => {
    const track = FIRST_RECORD.tracks[1]!;
    const video = FIRST_RECORD.videos[1]!;
    await app.given.trackMark({
      releaseId: FIRST_RECORD.id,
      position: track.position,
      mark: "keep",
      videoId: video.id,
      atSeconds: 37,
    });
    const triage = new TriagePage(app);
    const twelves = new TwelvesPage(app);
    await app.open();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await expect(triage.currentTrack).toHaveAttribute(
      "data-position",
      FIRST_RECORD.tracks[0]!.position,
    );
    await new HeaderPage(app).goTo("twelves");
    await twelves.showShelf("tracks");
    await twelves.replaySelected(FIRST_RECORD.id);
    await expect(triage.currentTrack).toHaveAttribute("data-position", track.position);
    await expect
      .poll(() => app.youtube.loads())
      .toContainEqual(expect.objectContaining({ videoId: video.id, startSeconds: 37 }));
    expect(
      (await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`)).verdict,
    ).toBeNull();
  },
);
