import type { DecisionsExport } from "../../../src/shared/api.ts";
import { rejudgedSentence } from "../../../src/client/twelves/model.ts";
import {
  DJ,
  EVENT_HORIZON,
  FIRST_RECORD,
  type FixtureRelease,
  IN_COLLECTION,
  MAYBE_LIST,
  ON_WANTLIST,
  SECOND_RECORD,
  THIRD_RECORD,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { datedVerdicts } from "../fixtures/decisions.ts";
import { isRequest, waitForResponses } from "../pages/triage.ts";
import { judgeKey, TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

// Twelves and Discogs: re-judging, retried pushes, the Maybe list and undo, with dj's collection
// and wantlist imported (docs/e2e/scenarios/twelves.md).

const ACCOUNT = { template: "small-account", savedToken: "e2e-token-dj" } as const;

/** The marker on a row whose want or grail is not on the Discogs wantlist. */
const NOT_ON_WANTLIST = "not on your Discogs wantlist";
/** The marker on a row whose maybe is not on the Discogs Maybe list. */
const NOT_ON_MAYBE_LIST = "not on your Discogs Maybe list yet";

/** How the shelf names a record in its messages. */
function nameOf(fixture: FixtureRelease): string {
  return `${fixture.artists.join(", ")} – ${fixture.title}`;
}

function onWantlist(fakes: { wantlists: Map<string, Map<number, string | null>> }): number[] {
  return [...fakes.wantlists.get(DJ.username)!.keys()];
}

test.describe("with a Discogs account", () => {
  test.use({ diggaOptions: ACCOUNT });

  test(
    "TWL-07 a want on the Discogs wantlist re-judged a grail stays on it",
    { tag: ["@TWL-07", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(ON_WANTLIST);
      await app.given.verdicts(datedVerdicts([{ release: ON_WANTLIST, status: "accepted" }]));
      await twelves.open();
      await twelves.showShelf("accepted");
      expect(await twelves.selectedKey()).toBe(key);
      await expect(twelves.record(key)).not.toContainText(NOT_ON_WANTLIST);
      // Saving the token asked Discogs whose it is, before the page opened.
      const fakeRequestsBefore = fakes.log.length;

      await twelves.rejudge("candidate");

      await expect(twelves.messages).toHaveText(
        `${rejudgedSentence(nameOf(ON_WANTLIST), "candidate")} Z undoes it.`,
      );
      await twelves.showShelf("candidate");
      await expect(twelves.stamp(twelves.record(key), "candidate")).toBeVisible();
      await expect(twelves.record(key)).not.toContainText(NOT_ON_WANTLIST);
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([]);
      expect(onWantlist(fakes)).toContain(ON_WANTLIST.id);
    },
  );

  test(
    "TWL-07 a want on the Discogs wantlist re-judged a skip comes off it and off the shelves",
    { tag: ["@TWL-07", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(ON_WANTLIST);
      await app.given.verdicts(datedVerdicts([{ release: ON_WANTLIST, status: "accepted" }]));
      await twelves.open();
      await twelves.showShelf("accepted");
      expect(await twelves.selectedKey()).toBe(key);

      await twelves.rejudge("rejected");

      await expect(twelves.messages).toHaveText(
        `${rejudgedSentence(nameOf(ON_WANTLIST), "rejected")} Taken off your Discogs wantlist. Z undoes it.`,
      );
      await expect(twelves.record(key)).toHaveCount(0);
      await twelves.showShelf("all");
      await expect(twelves.records.first()).toBeVisible();
      await expect(twelves.record(key)).toHaveCount(0);
      expect(fakes.requests("DELETE /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: DJ.username, id: String(ON_WANTLIST.id) } }),
      ]);
      expect(onWantlist(fakes)).not.toContain(ON_WANTLIST.id);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "rejected" }),
      );
    },
  );

  test(
    "TWL-07 a snooze re-judged a want goes on the Discogs wantlist",
    { tag: ["@TWL-07", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(FIRST_RECORD);
      await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));
      await twelves.open();
      await twelves.showShelf("snoozed");
      expect(await twelves.selectedKey()).toBe(key);

      await twelves.rejudge("accepted");

      await expect(twelves.messages).toHaveText(
        `${rejudgedSentence(nameOf(FIRST_RECORD), "accepted")} Added to your Discogs wantlist. Z undoes it.`,
      );
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: DJ.username, id: String(FIRST_RECORD.id) } }),
      ]);
      await twelves.showShelf("accepted");
      await expect(twelves.stamp(twelves.record(key), "accepted")).toBeVisible();
      await expect(twelves.record(key)).not.toContainText(NOT_ON_WANTLIST);
    },
  );

  test(
    "TWL-09 wants missing from the wantlist are marked and counted; A, C and add all push them",
    { tag: ["@TWL-09", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const missing = [FIRST_RECORD, SECOND_RECORD, THIRD_RECORD, EVENT_HORIZON];
      await app.given.verdicts(
        datedVerdicts([
          { release: FIRST_RECORD, status: "accepted" },
          { release: SECOND_RECORD, status: "candidate" },
          { release: THIRD_RECORD, status: "accepted" },
          { release: EVENT_HORIZON, status: "accepted" },
        ]),
      );
      await twelves.open();
      await expect(twelves.wantlistHandoff).toHaveText(
        "4 records are not on your Discogs wantlist. A on a want or C on a grail adds it.",
      );
      for (const fixture of missing)
        await expect(twelves.record(triageKeyOf(fixture))).toContainText(NOT_ON_WANTLIST);
      // The seeds from dj's wantlist are on it.
      await expect(twelves.record(triageKeyOf(ON_WANTLIST))).not.toContainText(NOT_ON_WANTLIST);

      await twelves.showShelf("accepted");
      await expect(twelves.wantlistHandoff).toContainText("3 records are not");
      expect(await twelves.selectedKey()).toBe(triageKeyOf(FIRST_RECORD));
      await twelves.retryPush("accepted");
      await expect(twelves.messages).toHaveText(
        `${nameOf(FIRST_RECORD)}: added to your Discogs wantlist.`,
      );
      await expect(twelves.record(triageKeyOf(FIRST_RECORD))).not.toContainText(NOT_ON_WANTLIST);
      await expect(twelves.wantlistHandoff).toContainText("2 records are not");

      await twelves.showShelf("candidate");
      await expect(twelves.wantlistHandoff).toContainText("1 record is not");
      await expect(twelves.addAllButton).toHaveCount(0);
      await twelves.retryPush("candidate");
      await expect(twelves.wantlistHandoff).toHaveText(
        "Everything here is on your Discogs wantlist.",
      );

      await twelves.showShelf("accepted");
      await expect(twelves.addAllButton).toHaveText("add all 2");
      await twelves.addAllToWantlist();
      await expect(twelves.messages).toHaveText("2 added to your Discogs wantlist.");
      await expect(twelves.wantlistHandoff).toHaveText(
        "Everything here is on your Discogs wantlist.",
      );
      await expect(twelves.addAllButton).toHaveCount(0);
      await expect(twelves.root.getByText(NOT_ON_WANTLIST, { exact: true })).toHaveCount(0);
      expect(
        fakes.requests("PUT /users/:user/wants/:id").map((request) => Number(request.params.id)),
      ).toEqual(missing.map((fixture) => fixture.id));
    },
  );

  test(
    "TWL-17 A then R pressed at once end as a skip, off the Discogs wantlist, one change after the other",
    { tag: ["@TWL-17", "@P2"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(FIRST_RECORD);
      const wantlist = `/api/discogs/wantlist/${FIRST_RECORD.id}`;
      await app.given.verdicts(datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]));
      await twelves.open();
      expect(await twelves.selectedKey()).toBe(key);
      const requestsBefore = app.apiRequests().length;
      const { first: removed, next: reloaded } = waitForResponses(
        app.page,
        (response) => isRequest(response, "DELETE", wantlist),
        (response) => isRequest(response, "GET", "/api/twelves"),
      );

      await app.page.keyboard.press(judgeKey("accepted"));
      await app.page.keyboard.press(judgeKey("rejected"));

      expect((await removed).ok()).toBe(true);
      expect((await reloaded).ok()).toBe(true);
      await expect(twelves.messages).toHaveText(
        `${rejudgedSentence(nameOf(FIRST_RECORD), "rejected")} Taken off your Discogs wantlist. Z undoes it.`,
      );
      // Decision 62: one change at a time, and re-judging a want always sends the removal.
      expect(
        app
          .apiRequests()
          .slice(requestsBefore)
          .filter((request) => !request.startsWith("GET ")),
      ).toEqual([
        "POST /api/verdicts",
        `POST ${wantlist}`,
        "POST /api/verdicts",
        `DELETE ${wantlist}`,
      ]);
      const [put] = fakes.requests("PUT /users/:user/wants/:id");
      const [removal] = fakes.requests("DELETE /users/:user/wants/:id");
      expect(put).toMatchObject({ params: { id: String(FIRST_RECORD.id) } });
      expect(removal).toMatchObject({ params: { id: String(FIRST_RECORD.id) } });
      expect(removal!.arrivedAt).toBeGreaterThanOrEqual(put!.answeredAt!);
      expect(onWantlist(fakes)).not.toContain(FIRST_RECORD.id);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "rejected" }),
      );
      await expect(twelves.record(key)).toHaveCount(0);
    },
  );

  test(
    "TWL-11 Z undoes the last change, its wantlist request included",
    { tag: ["@TWL-11", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      const key = triageKeyOf(FIRST_RECORD);
      const [snooze] = datedVerdicts([{ release: FIRST_RECORD, status: "snoozed" }]);
      await app.given.verdict(snooze!);
      await twelves.open();
      await twelves.showShelf("snoozed");
      await twelves.rejudge("accepted");
      await expect(twelves.record(key)).toHaveCount(0);

      await twelves.undo();

      await expect(twelves.messages).toHaveText("Undone.");
      await expect(twelves.stamp(twelves.record(key), "snoozed")).toBeVisible();
      const [put] = fakes.requests("PUT /users/:user/wants/:id");
      const [removal] = fakes.requests("DELETE /users/:user/wants/:id");
      expect(removal).toMatchObject({
        params: { user: DJ.username, id: String(FIRST_RECORD.id) },
      });
      expect(removal!.arrivedAt).toBeGreaterThanOrEqual(put!.answeredAt!);
      expect(onWantlist(fakes)).not.toContain(FIRST_RECORD.id);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "snoozed", decidedAt: snooze!.decidedAt }),
      );
    },
  );
});

test.describe("on an account's library", () => {
  test.use({ diggaOptions: { template: "small-account" } });

  test(
    "TWL-08 wantlist and owned records refuse re-judging with a flash",
    { tag: ["@TWL-08", "@P2"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      const refusal = "Wantlist and owned records come from Discogs; change them there.";
      await twelves.open();

      for (const [shelf, fixture, status] of [
        ["wantlist", ON_WANTLIST, "rejected"],
        ["collection", IN_COLLECTION, "accepted"],
      ] as const) {
        await twelves.showShelf(shelf);
        const row = twelves.record(triageKeyOf(fixture));
        await twelves.select(triageKeyOf(fixture));
        await app.page.keyboard.press(judgeKey(status));
        await expect(twelves.messages).toHaveText(refusal);
        await expect(twelves.stamp(row, shelf)).toBeVisible();
        // The refusal comes from the queued change itself, which sends nothing.
        expect(app.apiRequests()).not.toContain("POST /api/verdicts");
      }
    },
  );
});

test.describe("without a Maybe list", () => {
  test.use({ diggaOptions: { template: "small-account" } });

  test(
    "TWL-10 without a Maybe list, the Maybe shelf points to Settings and I reads nothing",
    { tag: ["@TWL-10", "@P1"] },
    async ({ app }) => {
      const twelves = new TwelvesPage(app);
      await app.given.verdicts(
        datedVerdicts([
          { release: FIRST_RECORD, status: "maybe" },
          { release: SECOND_RECORD, status: "maybe" },
        ]),
      );
      await twelves.open();
      await twelves.showShelf("maybe");

      await expect(twelves.maybeHandoff).toHaveText(
        "Pick your Discogs Maybe list in Settings, under Discogs, to keep this shelf in step with it.",
      );
      await app.page.keyboard.press("i");
      await expect(twelves.messages).toHaveText("Pick your Discogs Maybe list in Settings first.");
      // The flash comes from the key press itself; nothing was sent for it.
      expect(app.apiRequests().filter((request) => request.includes("/api/jobs/import"))).toEqual(
        [],
      );
    },
  );
});

test.describe("with a Maybe list", () => {
  test.use({
    diggaOptions: { ...ACCOUNT, config: { discogs: { maybeListId: MAYBE_LIST.id } } },
  });

  test(
    "TWL-10 maybes not on the Discogs Maybe list are counted, and I reads the list",
    { tag: ["@TWL-10", "@P1"] },
    async ({ app, fakes }) => {
      const twelves = new TwelvesPage(app);
      // The list holds the first two records; the third maybe is not on it.
      await app.given.verdicts(
        datedVerdicts([
          { release: FIRST_RECORD, status: "maybe" },
          { release: SECOND_RECORD, status: "maybe" },
          { release: EVENT_HORIZON, status: "maybe" },
        ]),
      );
      await twelves.open();
      await twelves.showShelf("maybe");
      await expect(twelves.maybeHandoff).toHaveText(
        /^3 maybes are not on your Discogs Maybe list yet\./,
      );
      await expect(twelves.root.getByText(NOT_ON_MAYBE_LIST, { exact: true })).toHaveCount(3);

      await twelves.checkMaybeList();

      await expect(twelves.messages).toHaveText(
        "Your Discogs Maybe list has 2 records; 2 new here.",
      );
      await expect(twelves.maybeHandoff).toHaveText(
        /^1 maybe is not on your Discogs Maybe list yet\./,
      );
      await expect(twelves.record(triageKeyOf(EVENT_HORIZON))).toContainText(NOT_ON_MAYBE_LIST);
      for (const fixture of [FIRST_RECORD, SECOND_RECORD])
        await expect(twelves.record(triageKeyOf(fixture))).not.toContainText(NOT_ON_MAYBE_LIST);
      expect(fakes.requests("GET /lists/:id")).toEqual([
        expect.objectContaining({
          params: { id: String(MAYBE_LIST.id) },
          authenticatedAs: DJ.username,
        }),
      ]);
    },
  );
});
