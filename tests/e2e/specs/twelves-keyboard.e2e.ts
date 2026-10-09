import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { FIRST_RECORD, SECOND_RECORD, triageKeyOf } from "../fixtures/catalogue.ts";
import { TwelvesPage, judgeKey } from "../pages/twelves.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small", clock: true } });

test(
  "TWL-25 holding a verdict key changes only one record",
  { tag: ["@TWL-25", "@P1"] },
  async ({ app }) => {
    for (const release of [FIRST_RECORD, SECOND_RECORD]) {
      await app.given.verdict({
        key: triageKeyOf(release),
        status: "snoozed",
        releaseId: release.id,
      });
    }
    const twelves = new TwelvesPage(app);
    await twelves.open();
    await expect(twelves.records).toHaveCount(2);
    await app.clock.pause();
    const key = judgeKey("rejected");
    const reloaded = app.page.waitForResponse((response) =>
      response.url().endsWith("/api/twelves"),
    );
    await app.page.keyboard.down(key);
    await (await reloaded).finished();
    await expect(twelves.records).toHaveCount(1);
    await expect(twelves.messages).toContainText("Z undoes it.");
    const remainingId = Number(await twelves.selected.getAttribute("data-release-id"));

    const writes: string[] = [];
    app.page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/verdicts"))
        writes.push(request.url());
    });
    await app.page.keyboard.down(key);
    await app.page.keyboard.up(key);
    await twelves.cycleSort();
    await app.page.clock.runFor(1000);
    await expect(twelves.records).toHaveCount(1);
    expect(writes).toEqual([]);
    const remaining = await app.api.get<ReleaseDetail>(`/api/releases/${remainingId}`);
    expect(remaining.verdict?.status).toBe("snoozed");
  },
);
