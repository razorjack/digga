import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { FIRST_RECORD } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test(
  "TRI-47 history exclusion and heard-tune skipping can be disabled independently",
  { tag: ["@TRI-47", "@P1"] },
  async ({ app }) => {
    const track = FIRST_RECORD.tracks[0]!;
    const video = FIRST_RECORD.videos[0]!;
    await app.given.verdict({
      key: `m:${FIRST_RECORD.master!.id}`,
      releaseId: FIRST_RECORD.id,
      status: "seen",
      source: "seed:history",
    });
    await app.given.listen({
      releaseId: FIRST_RECORD.id,
      position: track.position,
      videoId: video.id,
      seconds: 5,
    });
    const settings = new SettingsPage(app);
    const triage = new TriagePage(app);
    await settings.open();
    await expect(settings.skipHistory).toBeChecked();
    await expect(settings.skipHeard).toBeChecked();
    await settings.skipHistory.uncheck();
    await settings.skipHeard.uncheck();
    await settings.save();
    await new HeaderPage(app).goTo("triage");
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await expect(triage.currentTrack).toHaveAttribute("data-position", track.position);
    await triage.judge("rejected");
    await triage.undoToPreviousVerdict();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    expect(
      (await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`)).verdict?.status,
    ).toBe("seen");
  },
);
