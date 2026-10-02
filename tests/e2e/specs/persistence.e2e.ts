import { STATUS_COPY } from "../../../src/client/keymap.ts";
import { MARK_COPY } from "../../../src/client/twelves/model.ts";
import type { DecisionsExport } from "../../../src/shared/api.ts";
import { releaseById } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { isRequest, TriagePage, verdictKey } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

/** A snooze with a note, and a keep mark on one of the record's tracks. */
interface KeptDecisions {
  key: string;
  releaseId: number;
  title: string;
  note: string;
  position: string;
  trackTitle: string;
}

test(
  "PER-01 a live snooze with a note and a keep mark survive a reload and a relaunch",
  { tag: ["@PER-01", "@P0"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const key = await triage.currentKey();
    const release = releaseById(Number(await triage.record.getAttribute("data-release-id")))!;
    const track = release.tracks[0]!;
    const kept: KeptDecisions = {
      key,
      releaseId: release.id,
      title: release.title,
      note: "hear it again at the weekend",
      position: track.position,
      trackTitle: track.title,
    };

    await triage.startListening();
    await triage.markTrack("keep");
    await expect(triage.trackMark(track.position, "keep")).toBeVisible();
    await triage.writeNote(kept.note);
    await triage.judge("snoozed");

    await app.page.reload();
    await expectKept(app, kept);

    await app.relaunch();
    await app.open();
    await expectKept(app, kept);
  },
);

test(
  "PER-05 after restartServer() the open page keeps its session without a reload, and the next verdict is saved",
  { tag: ["@PER-05", "@P1", "@web"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    await app.open();
    const first = await triage.currentKey();
    // The header reads the stats 0.5 s after a verdict, the last request the verdict causes.
    const refreshed = app.page.waitForResponse((response) =>
      isRequest(response, "GET", "/api/stats"),
    );
    await triage.judge("rejected");
    await (await refreshed).finished();
    await expect(header.root).toContainText("1 dug");
    const second = await triage.currentKey();
    const origin = app.origin;

    await app.restartServer();
    expect(app.servers).toHaveLength(2);
    expect(app.origin).toBe(origin);

    // No reload: the record, the slip and the session's count are as the old server left them.
    expect(await triage.currentKey()).toBe(second);
    await expect(triage.lastAction).toContainText(STATUS_COPY.rejected);
    await triage.judge("snoozed");
    await expect(header.root).toContainText("2 dug");
    await expect(header.root).toContainText("+2 this session");
    expect(await exportedStatus(app, first)).toBe("rejected");
    expect(await exportedStatus(app, second)).toBe("snoozed");
  },
);

test.describe("with a Discogs account and the clock", () => {
  test.use({
    diggaOptions: { template: "small-account", savedToken: "e2e-token-dj", clock: true },
  });

  test(
    "PER-04 a verdict the server never got comes back, pushes nothing, and saves on the next try",
    { tag: ["@PER-04", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      app.expectProblems({
        aborted: [/^POST \/api\/verdicts$/],
        consoleErrors: [/^Failed to load resource: net::ERR_FAILED/],
      });
      await app.abortRequests({ method: "POST", path: "/api/verdicts" });
      await app.open();
      const key = await triage.currentKey();
      const releaseId = await triage.record.getAttribute("data-release-id");
      // Saving the token asked Discogs whose it is, before the page opened.
      const fakeRequestsBefore = fakes.log.length;

      await app.page.keyboard.press(verdictKey("accepted"));
      await expect(triage.messages).toHaveText(/^The verdict was not saved: \S/);
      await expect(triage.record).toHaveAttribute("data-triage-key", key);
      await expect(triage.lastAction).not.toHaveAttribute("aria-busy", "true");

      expect(app.apiRequests().filter((request) => request.includes("/api/discogs/"))).toEqual([]);
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([]);
      expect(await exportedStatus(app, key)).toBeUndefined();

      await triage.judge("accepted");
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      expect(await exportedStatus(app, key)).toBe("accepted");
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({ params: { user: "dj", id: releaseId } }),
      ]);
    },
  );
});

/** Triage no longer offers the record; Twelves and the export show the snooze and the mark. */
async function expectKept(app: DiggaApp, kept: KeptDecisions): Promise<void> {
  const twelves = new TwelvesPage(app);
  expect(await new TriagePage(app).currentKey()).not.toBe(kept.key);

  await new HeaderPage(app).goTo("twelves");
  await twelves.showShelf("snoozed");
  await expect(twelves.row("snoozed", kept.title)).toContainText(kept.note);
  await twelves.showShelf("tracks");
  await expect(twelves.row("tracks", kept.trackTitle)).toContainText(MARK_COPY.keep);

  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  expect(exported.verdicts).toContainEqual(
    expect.objectContaining({ key: kept.key, status: "snoozed", notes: kept.note }),
  );
  expect(exported.trackMarks).toContainEqual(
    expect.objectContaining({ releaseId: kept.releaseId, position: kept.position, mark: "keep" }),
  );
}

async function exportedStatus(app: DiggaApp, key: string): Promise<string | undefined> {
  const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
  return exported.verdicts.find((verdict) => verdict.key === key)?.status;
}
