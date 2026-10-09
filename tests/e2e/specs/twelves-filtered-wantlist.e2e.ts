import type { TwelvesResponse } from "../../../src/shared/api.ts";
import {
  DJ,
  FIRST_RECORD,
  SECOND_RECORD,
  THIRD_RECORD,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small-account", savedToken: "e2e-token-dj" } });

test(
  "TWL-27 add all respects the shelf search",
  { tag: ["@TWL-27", "@P1"] },
  async ({ app, fakes }) => {
    for (const release of [FIRST_RECORD, SECOND_RECORD, THIRD_RECORD]) {
      await app.given.verdict({
        key: triageKeyOf(release),
        releaseId: release.id,
        status: "accepted",
      });
    }
    const twelves = new TwelvesPage(app);
    await twelves.open();
    await twelves.filterBy(SECOND_RECORD.label.name);
    await expect(twelves.records).toHaveCount(2);
    await expect(twelves.addAllButton).toHaveText("add all 2");
    await twelves.addAllToWantlist();
    await expect(twelves.messages).toHaveText("2 added to your Discogs wantlist.");
    const added = fakes.requests("PUT /users/:user/wants/:id").map((request) => request.params);
    expect(added).toEqual(
      expect.arrayContaining([
        { user: DJ.username, id: String(SECOND_RECORD.id) },
        { user: DJ.username, id: String(THIRD_RECORD.id) },
      ]),
    );
    expect(added).toHaveLength(2);
    const items = (await app.api.get<TwelvesResponse>("/api/twelves")).items;
    expect(
      items.find((item) => item.key === triageKeyOf(FIRST_RECORD))?.membership.onWantlist,
    ).toBe(false);
  },
);
