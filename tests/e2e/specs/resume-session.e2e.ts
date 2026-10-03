import type { SavedSession } from "../../../src/shared/digging-session.ts";
import { FIRST_RECORD, SECOND_RECORD, THIRD_RECORD } from "../fixtures/catalogue.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test.use({
  diggaOptions: { clock: true, labels: [FIRST_RECORD.label.name, SECOND_RECORD.label.name] },
});

test(
  "PER-09 resume restores the passed records, current upload, and paused playback position",
  { tag: ["@PER-09", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.given.verdict({
      key: `r:${THIRD_RECORD.id}`,
      releaseId: THIRD_RECORD.id,
      status: "rejected",
    });
    await app.open();
    await app.clock.pause();
    await triage.startListening();
    await triage.pass();
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));
    await triage.pause();
    await app.page.keyboard.press("ArrowRight");
    await triage.checkpointSession();
    const saved = await app.api.get<SavedSession>("/api/sessions/latest");
    expect(saved.state.passedIds).toContain(FIRST_RECORD.id);
    expect(saved.state.currentId).toBe(SECOND_RECORD.id);
    expect(saved.state.playback?.videoId).toBe(SECOND_RECORD.videos[0]!.id);
    await app.page.reload();
    await expect(triage.resumeSession).toBeVisible();
    await triage.resumeSessionFromCheckpoint();
    await expect(triage.record).toHaveAttribute("data-release-id", String(SECOND_RECORD.id));
    await expect(triage.playerStatus("paused")).toBeVisible();
    await expect
      .poll(() => app.youtube.loads())
      .toContainEqual(
        expect.objectContaining({
          kind: "cue",
          videoId: saved.state.playback!.videoId,
          startSeconds: saved.state.playback!.atSeconds,
        }),
      );
    await triage.pass();
    await expect(triage.goRoundButton).toContainText("2 you passed");
    await triage.goRound();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
  },
);
