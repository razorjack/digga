import type { DecisionsExport, Stats } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { DJ, IN_COLLECTION, releaseById } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { isRequest, LOGGED_LISTEN_MS, PAST_SANDBOX_PUSH_MS, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

/** The digging writes, which the sandbox keeps in the tab (docs/DECISIONS.md, decision 27). */
const DIGGING_WRITE =
  /^(POST|PUT|DELETE) \/api\/(verdicts|track-verdicts|listen-log|discogs\/wantlist)\b/;

test.describe("in the sandbox, with a Discogs account", () => {
  test.use({
    diggaOptions: {
      template: "small-account",
      savedToken: "e2e-token-dj",
      sandbox: true,
      clock: true,
    },
  });

  test(
    "SBX-01 verdicts, marks, notes, listens and wants stay in the tab and reach neither server",
    { tag: ["@SBX-01", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      await app.open();
      await expect(new HeaderPage(app).sandbox).toBeVisible();
      const release = releaseById(Number(await triage.record.getAttribute("data-release-id")))!;
      const heard = release.tracks[0]!;

      await triage.startListening();
      await app.clock.runFor(LOGGED_LISTEN_MS);
      await triage.markTrackInSandbox("keep", heard.position);
      await app.page.keyboard.press("j");
      await expect(triage.track(heard.position)).toContainText("played");
      await triage.writeNote("only in this tab");
      await triage.judgeInSandbox("rejected");
      await expect(triage.lastAction).toContainText("Sandbox: nothing was saved.");

      await triage.judgeInSandbox("accepted");
      await app.clock.runFor(PAST_SANDBOX_PUSH_MS);
      await expect(triage.lastAction).toContainText(
        "Added to your wantlist (sandbox: nothing sent).",
      );
      await app.page.keyboard.press("z");
      await expect(triage.messages).toHaveText(
        "Taken off your wantlist again (sandbox: nothing sent).",
      );

      expect(app.apiRequests().filter((request) => DIGGING_WRITE.test(request))).toEqual([]);
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([]);
      expect(fakes.requests("DELETE /users/:user/wants/:id")).toEqual([]);
    },
  );
});

test.describe("in the sandbox", () => {
  test.use({ diggaOptions: { sandbox: true } });

  test(
    "SBX-02 sandbox verdicts show in Twelves and the header's counts, and a reload drops them",
    { tag: ["@SBX-02", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const twelves = new TwelvesPage(app);
      const header = new HeaderPage(app);
      const before = await app.api.get<Stats>("/api/stats");
      await app.open();

      const snoozed = [await triage.currentKey()];
      await triage.judgeInSandbox("snoozed");
      snoozed.push(await triage.currentKey());
      await triage.judgeInSandbox("snoozed");
      await expect(header.root).toContainText(`${formatCount(before.dug + 2)} dug`);
      await expect(header.root).toContainText(`${formatCount(before.remaining - 2)} to go`);
      await expect(header.root).toContainText("+2 this session");

      await header.goTo("twelves");
      await twelves.showShelf("snoozed");
      await expect(twelves.shelfOption("snoozed")).toHaveAccessibleName("Snoozed 2");
      await expect(twelves.records).toHaveCount(2);
      expect(await twelves.recordKeys()).toEqual(expect.arrayContaining(snoozed));

      await twelves.reload();
      await twelves.showShelf("snoozed");
      await expect(twelves.shelfOption("snoozed")).toHaveAccessibleName("Snoozed 0");
      await expect(twelves.records).toHaveCount(0);
      await expect(header.root).toContainText(`${formatCount(before.dug)} dug`);
      await expect(header.root).not.toContainText("this session");
    },
  );

  test(
    "SBX-03 turning the sandbox off drops its verdicts and undo history and saves the next verdict; turning it on again starts an empty sandbox",
    { tag: ["@SBX-03", "@P1"] },
    async ({ app }) => {
      const triage = new TriagePage(app);
      const settings = new SettingsPage(app);
      const header = new HeaderPage(app);
      await app.open();
      const first = await triage.currentKey();
      await triage.judgeInSandbox("snoozed");
      const second = await triage.currentKey();
      await triage.judgeInSandbox("snoozed");

      await header.goTo("settings");
      await settings.switchSandbox("off");
      await header.goTo("triage");
      await expect(triage.record).toHaveAttribute("data-triage-key", first);
      await expectNothingToUndo(triage);
      await triage.judge("rejected");
      expect(await exportedVerdicts(app)).toEqual([
        expect.objectContaining({ key: first, status: "rejected" }),
      ]);

      await header.goTo("settings");
      await settings.switchSandbox("on");
      await header.goTo("triage");
      await expect(triage.record).toHaveAttribute("data-triage-key", second);
      await expectNothingToUndo(triage);
      await expect(header.root).not.toContainText("this session");
      const twelves = new TwelvesPage(app);
      await header.goTo("twelves");
      await twelves.showShelf("snoozed");
      await expect(twelves.shelfOption("snoozed")).toHaveAccessibleName("Snoozed 0");
    },
  );
});

test.describe("in the sandbox, with a Discogs account and the clock", () => {
  test.use({
    diggaOptions: {
      template: "small-account",
      savedToken: "e2e-token-dj",
      sandbox: true,
      clock: true,
    },
  });

  test(
    "SBX-04 a want given in the sandbox, then the sandbox turned off before its push ends, never reaches Discogs",
    { tag: ["@SBX-04", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const settings = new SettingsPage(app);
      const header = new HeaderPage(app);
      await app.open();
      const key = await triage.currentKey();

      await app.clock.pause();
      await triage.judgeInSandbox("accepted");
      await header.goTo("settings");
      await settings.switchSandbox("off");
      await app.clock.runFor(PAST_SANDBOX_PUSH_MS);
      // A request the sandbox push's end started would be in the log before the answer to this one.
      await triage.showAgain();

      expect(await triage.currentKey()).toBe(key);
      expect(
        app.apiRequests().filter((request) => request.includes("/api/discogs/wantlist")),
      ).toEqual([]);
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([]);
      expect(await exportedVerdicts(app)).not.toContainEqual(expect.objectContaining({ key }));
    },
  );
});

test.describe("with a Discogs account and the clock", () => {
  test.use({
    diggaOptions: { template: "small-account", savedToken: "e2e-token-dj", clock: true },
  });

  test(
    "SBX-07 a want given live is pushed at once, and stays saved and on the wantlist when the sandbox is turned on",
    { tag: ["@SBX-07", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const settings = new SettingsPage(app);
      const header = new HeaderPage(app);
      const twelves = new TwelvesPage(app);
      await app.open();
      const key = await triage.currentKey();
      const releaseId = await triage.record.getAttribute("data-release-id");

      const pushed = app.page.waitForResponse((response) =>
        isRequest(response, "POST", `/api/discogs/wantlist/${releaseId}`),
      );
      await triage.judge("accepted");
      expect((await pushed).ok()).toBe(true);
      await header.goTo("settings");
      await settings.switchSandbox("on");

      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: "dj", id: releaseId } }),
      ]);
      expect(await exportedVerdicts(app)).toContainEqual(
        expect.objectContaining({ key, status: "accepted" }),
      );
      await header.goTo("twelves");
      await twelves.showShelf("accepted");
      await expect(twelves.record(key)).toBeVisible();
      await expect(twelves.record(key)).not.toContainText("not on your Discogs wantlist");
      await expect(twelves.wantlistHandoff).toHaveText(
        "Everything here is on your Discogs wantlist.",
      );
    },
  );
});

test.describe("in the sandbox, with dj's username and token", () => {
  test.use({
    diggaOptions: {
      sandbox: true,
      config: { discogs: { username: DJ.username } },
      savedToken: "e2e-token-dj",
    },
  });

  test(
    "SBX-05 setup work is real in the sandbox: a collection import fills the Owned shelf, and P asks Discogs",
    { tag: ["@SBX-05", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const twelves = new TwelvesPage(app);
      const triage = new TriagePage(app);
      const header = new HeaderPage(app);
      await settings.open();

      const job = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Collection" }),
      );
      await settings.waitForJob(job, "done");
      await header.goTo("twelves");
      await twelves.showShelf("collection");
      await expect(twelves.row("collection", IN_COLLECTION.title)).toBeVisible();
      // The sandbox starts empty after a reload; the import was saved.
      await twelves.reload();
      await twelves.showShelf("collection");
      await expect(twelves.row("collection", IN_COLLECTION.title)).toBeVisible();

      await header.goTo("triage");
      const releaseId = await triage.record.getAttribute("data-release-id");
      await triage.askMarket();
      expect(fakes.requests("GET /releases/:id")).toEqual([
        expect.objectContaining({ params: { id: releaseId }, query: { curr_abbr: "EUR" } }),
      ]);
    },
  );
});

/** Z with an empty undo history only says so; the record stays and nothing is sent. */
async function expectNothingToUndo(triage: TriagePage): Promise<void> {
  const key = await triage.currentKey();
  await triage.app.page.keyboard.press("z");
  await expect(triage.messages).toHaveText("Nothing to undo.");
  await expect(triage.record).toHaveAttribute("data-triage-key", key);
  expect(triage.app.apiRequests().filter((request) => request.startsWith("DELETE "))).toEqual([]);
}

async function exportedVerdicts(app: DiggaApp): Promise<DecisionsExport["verdicts"]> {
  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  return exported.verdicts;
}
