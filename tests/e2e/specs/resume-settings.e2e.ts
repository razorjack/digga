import type { Config } from "../../../src/shared/config.ts";
import { FIRST_RECORD } from "../fixtures/catalogue.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small", clock: true } });

test(
  "PER-13 resume retains labels hidden after the first checkpoint",
  { tag: ["@PER-13", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await app.clock.pause();
    await triage.checkpointSession();
    await triage.hideLabel();
    await triage.checkpointSession();
    await app.page.reload();
    await expect(triage.resumeSession).toBeVisible();
    await triage.resumeSessionFromCheckpoint();
    await expect(triage.record).not.toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    const config = await app.api.get<Config>("/api/settings");
    expect(config.filters.excludeLabels).toContainEqual(
      expect.objectContaining({ id: FIRST_RECORD.label.id, name: FIRST_RECORD.label.name }),
    );
  },
);
