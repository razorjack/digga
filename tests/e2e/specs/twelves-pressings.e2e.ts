import type { TwelvesResponse } from "../../../src/shared/api.ts";
import { DJ, MAIN_PRESSING, SHOP_PRESSING, triageKeyOf } from "../fixtures/catalogue.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small-account", savedToken: "e2e-token-dj" } });

for (const mode of ["shelf", "replay"] as const) {
  test(
    `TWL-28 ${mode} removes and restores the actual wanted pressing`,
    { tag: ["@TWL-28", "@P1"] },
    async ({ app, fakes }) => {
      const key = triageKeyOf(MAIN_PRESSING);
      await app.given.verdict({ key, releaseId: MAIN_PRESSING.id, status: "accepted" });
      await app.api.send("POST", `/api/discogs/wantlist/${SHOP_PRESSING.id}`);
      const twelves = new TwelvesPage(app);
      await twelves.open();
      await twelves.showShelf("accepted");
      await twelves.select(key);
      const path = `/api/discogs/wantlist/${SHOP_PRESSING.id}`;
      if (mode === "shelf") {
        await twelves.rejudge("rejected");
        await twelves.undo();
      } else {
        const triage = new TriagePage(app);
        await twelves.replaySelected(MAIN_PRESSING.id);
        const removed = app.page.waitForResponse(
          (response) => response.request().method() === "DELETE" && response.url().endsWith(path),
        );
        await triage.judge("rejected");
        await (await removed).finished();
        const restored = app.page.waitForResponse(
          (response) => response.request().method() === "POST" && response.url().endsWith(path),
        );
        await app.page.keyboard.press("z");
        await (await restored).finished();
      }
      expect(
        fakes.requests("DELETE /users/:user/wants/:id").map((request) => request.params),
      ).toEqual([{ user: DJ.username, id: String(SHOP_PRESSING.id) }]);
      expect(fakes.wantlists.get(DJ.username)?.has(SHOP_PRESSING.id)).toBe(true);
      expect(fakes.wantlists.get(DJ.username)?.has(MAIN_PRESSING.id)).toBe(false);
      const item = (await app.api.get<TwelvesResponse>("/api/twelves")).items.find(
        (item) => item.key === key,
      );
      expect(item?.verdict?.status).toBe("accepted");
      expect(item?.membership.wantlistReleaseIds).toEqual([SHOP_PRESSING.id]);
    },
  );
}
