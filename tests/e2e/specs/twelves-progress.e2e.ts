import type { TwelvesResponse } from "../../../src/shared/api.ts";
import { FIRST_RECORD, SECOND_RECORD, THIRD_RECORD, triageKeyOf } from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { judgeKey, TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small-account", savedToken: "e2e-token-dj" } });

test(
  "TWL-31 a saved verdict moves selection while Discogs is pending, and undo queues visibly",
  {
    tag: ["@TWL-31", "@P1"],
  },
  async ({ app, fakes }) => {
    const twelves = new TwelvesPage(app);
    const key = triageKeyOf(SECOND_RECORD);
    await app.given.verdicts(
      datedVerdicts([
        { release: FIRST_RECORD, status: "snoozed" },
        { release: SECOND_RECORD, status: "snoozed" },
        { release: THIRD_RECORD, status: "snoozed" },
      ]),
    );
    await twelves.open();
    await twelves.showShelf("snoozed");
    await twelves.select(key);
    const push = fakes.hold("PUT /users/:user/wants/:id");
    try {
      await app.page.keyboard.press(judgeKey("accepted"));
      await push.received;
      await expect(twelves.messages).toHaveText("Verdict saved. Updating your Discogs wantlist…");
      await expect(twelves.selected).toHaveAttribute("data-triage-key", triageKeyOf(THIRD_RECORD));
      await expect(twelves.record(key)).toHaveCount(0);
      expect(await twelves.move("k")).toBe(triageKeyOf(FIRST_RECORD));
      const saved = await app.api.get<TwelvesResponse>("/api/twelves");
      expect(saved.items.find((item) => item.key === key)).toMatchObject({
        verdict: { status: "accepted" },
        membership: { onWantlist: false },
      });
      await app.page.keyboard.press("z");
      await expect(twelves.messages).toContainText("1 change queued.");
    } finally {
      push.release();
    }
    await expect(twelves.messages).toHaveText("Undone.");
    await expect(twelves.stamp(twelves.record(key), "snoozed")).toBeVisible();
    const restored = await app.api.get<TwelvesResponse>("/api/twelves");
    expect(restored.items.find((item) => item.key === key)).toMatchObject({
      verdict: { status: "snoozed" },
      membership: { onWantlist: false },
    });
  },
);
