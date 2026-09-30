import { releaseById } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { LOGGED_LISTEN_MS, PAST_PUSH_GRACE_MS, TriagePage } from "../pages/triage.ts";
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
      await app.clock.runFor(PAST_PUSH_GRACE_MS);
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
