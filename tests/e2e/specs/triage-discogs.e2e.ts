import { STATUS_COPY } from "../../../src/client/keymap.ts";
import type { DecisionsExport, ReleaseDetail } from "../../../src/shared/api.ts";
import { discogsReleaseUrl } from "../../../src/shared/discogs-urls.ts";
import { formatCount, formatPrice, formatWait } from "../../../src/shared/display.ts";
import { PUSH_RETRY_DELAYS_MS } from "../../../src/shared/wantlist.ts";
import { youtubeSearchUrl } from "../../../src/shared/youtube.ts";
import { DJ, FIRST_RECORD } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { MARKET } from "../../../tools/dev/fake-services.ts";
import { expect, test } from "../support/test.ts";

// Triage and Discogs: pushes to the wantlist, the market line, and the links out
// (docs/e2e/scenarios/triage.md).

const ACCOUNT = { template: "small-account", savedToken: "e2e-token-dj" } as const;

test.describe("with a Discogs account", () => {
  test.use({ diggaOptions: ACCOUNT });

  test(
    "TRI-14 C pushes a grail like A, with a note of the grail and keep tracks and the record's note",
    { tag: ["@TRI-14", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const note = "the B side from the Kool FM tape";
      const [grail, keep] = FIRST_RECORD.tracks;
      await app.open();
      await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));

      await triage.startListening();
      await triage.markTrack("candidate");
      expect(await triage.nextTrack()).toBe(keep!.position);
      await triage.markTrack("keep");
      await triage.writeNote(note);
      const response = await triage.judgeAndPush("candidate");

      expect(response.ok()).toBe(true);
      await expect(triage.lastAction).toContainText(STATUS_COPY.candidate);
      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      // Decision 70: the marked tracks in tracklist order, then the record's note.
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({
          params: { user: DJ.username, id: String(FIRST_RECORD.id) },
          body: { notes: `grail ${grail!.position}; keep ${keep!.position}; ${note}` },
        }),
      ]);
    },
  );

  test(
    "TRI-39 Z while the push is in flight takes the want off Discogs once the push has landed",
    { tag: ["@TRI-39", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      await app.open();
      const key = await triage.currentKey();
      const releaseId = await triage.record.getAttribute("data-release-id");
      const push = fakes.hold("PUT /users/:user/wants/:id");

      await triage.judge("accepted");
      await push.received;
      await triage.undoVerdict(key);
      await expect(triage.lastAction).toContainText("undone");
      const takenOff = app.page.waitForResponse((response) =>
        isRequest(response, "DELETE", `/api/discogs/wantlist/${releaseId}`),
      );
      push.release();
      const response = await takenOff;
      expect(response.ok()).toBe(true);
      await response.finished();

      await expect(triage.messages).toHaveText("Taken off your Discogs wantlist again.");
      const [put] = fakes.requests("PUT /users/:user/wants/:id");
      const [removal] = fakes.requests("DELETE /users/:user/wants/:id");
      expect(put).toMatchObject({ params: { user: DJ.username, id: releaseId } });
      expect(removal).toMatchObject({ params: { user: DJ.username, id: releaseId } });
      expect(removal!.arrivedAt).toBeGreaterThanOrEqual(put!.answeredAt!);
      expect(fakes.wantlists.get(DJ.username)!.has(Number(releaseId))).toBe(false);
    },
  );

  test(
    "TRI-42 digging ten records asks Discogs nothing; P asks it first",
    { tag: ["@TRI-42", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      // Saving the token asked Discogs whose it is, before the page opened.
      const fakeRequestsBefore = fakes.log.length;
      await app.open();

      for (let count = 0; count < 10; count += 1) await triage.judge("rejected");

      // Each verdict was saved before the next, so the page has sent all it would.
      expect(app.apiRequests().filter((request) => request.includes("/api/discogs/"))).toEqual([]);
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([]);
      const releaseId = await triage.record.getAttribute("data-release-id");
      await triage.askMarket();
      expect(fakes.log.slice(fakeRequestsBefore)).toEqual([
        expect.objectContaining({ method: "GET", path: `/releases/${releaseId}` }),
      ]);
    },
  );
});

test(
  "TRI-23 P asks Discogs for the market, busy until the answer, then shows it as checked just now, and plays a video Discogs has since the dump",
  { tag: ["@TRI-23", "@P1"] },
  async ({ app, fakes }) => {
    const triage = new TriagePage(app);
    const [pressureDrop, , lowTide] = FIRST_RECORD.tracks.map((track) => track.position);
    const held = fakes.hold("GET /releases/:id");
    await app.open();
    await expect(triage.market).toHaveText("no price or have/want yet");
    await expect(triage.currentTrack).toHaveAttribute("data-position", pressureDrop!);
    await expect(triage.track(lowTide!)).toContainText("no video");

    const asked = triage.askMarket();
    await held.received;
    await expect(triage.market).toHaveAttribute("aria-busy", "true");
    await expect(triage.market).toHaveText("asking Discogs…");
    held.release();
    await asked;

    await expect(triage.market).toContainText(
      `${formatPrice(MARKET.lowestPrice, "EUR")} lowest, ${MARKET.numForSale} for sale`,
    );
    await expect(triage.market).toContainText(
      `${formatCount(MARKET.want)} want ${formatCount(MARKET.have)} have`,
    );
    await expect(triage.market).toContainText(
      `${MARKET.rating.average} of 5 from ${MARKET.rating.count} ratings`,
    );
    await expect(triage.market).toContainText("checked just now");
    expect(fakes.requests("GET /releases/:id")).toEqual([
      expect.objectContaining({
        params: { id: String(FIRST_RECORD.id) },
        query: { curr_abbr: "EUR" },
      }),
    ]);

    // The player plays a video the open release gains, as it does a pasted one; P is the gesture.
    await expect(triage.currentTrack).toHaveAttribute("data-position", lowTide!);
    await expect(triage.playerStatus("playing")).toBeVisible();
    expect(await app.youtube.audible()).toBe(FIRST_RECORD.laterVideos[0]!.id);
  },
);

test(
  "TRI-24 P for a release Discogs no longer has says so, and the line and the tracklist stay as they were",
  { tag: ["@TRI-24", "@P2"] },
  async ({ app, fakes }) => {
    const triage = new TriagePage(app);
    const releaseId = FIRST_RECORD.id;
    app.expectProblems({ apiErrors: [/^POST \/api\/releases\/\d+\/enrich answered 502$/] });
    fakes.fail("GET /releases/:id", { status: 404, times: 1 });
    await app.open();
    await expect(triage.record).toHaveAttribute("data-release-id", String(releaseId));
    await expect(triage.market).toHaveText("no price or have/want yet");
    const before = await app.api.get<ReleaseDetail>(`/api/releases/${releaseId}`);

    const asked = app.page.waitForResponse((response) =>
      isRequest(response, "POST", `/api/releases/${releaseId}/enrich`),
    );
    await app.page.keyboard.press("p");
    const response = await asked;
    expect(response.status()).toBe(502);
    await response.finished();

    await expect(triage.messages).toHaveText(
      "The price did not load: Discogs did not return the release",
    );
    await expect(triage.market).toHaveAttribute("aria-busy", "false");
    await expect(triage.market).toHaveText("no price or have/want yet");
    const [playing, withVideo, withoutVideo] = FIRST_RECORD.tracks.map((track) => track.position);
    await expect(triage.currentTrack).toHaveAttribute("data-position", playing!);
    await expect(triage.track(withVideo!)).toContainText("has a video");
    await expect(triage.track(withoutVideo!)).toContainText("no video");
    const after = await app.api.get<ReleaseDetail>(`/api/releases/${releaseId}`);
    expect(after.release.snapshot).toEqual(before.release.snapshot);
    expect(after.videos).toEqual(before.videos);
    expect(fakes.requests("GET /releases/:id")).toHaveLength(1);
  },
);

test.describe("with the username dj and the clock", () => {
  test.use({ diggaOptions: { config: { discogs: { username: DJ.username } }, clock: true } });

  test(
    "TRI-16 another account's token keeps the username and reads as a problem; a want then fails at once at Discogs",
    { tag: ["@TRI-16", "@P2"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      app.expectProblems({ apiErrors: [/^POST \/api\/discogs\/wantlist\/\d+ answered 403$/] });
      await settings.open("discogs");

      const saved = await settings.saveToken("e2e-token-other");
      expect(saved.status()).toBe(200);
      await expect(settings.root.getByText("Token saved.", { exact: true })).toBeVisible();
      await expect(settings.username).toHaveValue(DJ.username);
      await expect(settings.token).toHaveAccessibleDescription(
        /^The token belongs to other, not dj\. /,
      );

      await new HeaderPage(app).goTo("triage");
      const releaseId = await triage.record.getAttribute("data-release-id");
      // Paused, a retry would wait for runFor().
      await app.clock.pause();
      await triage.judge("accepted");

      await expect(triage.lastAction).toContainText("Saved, but not on the Discogs wantlist.");
      await expect(triage.messages).toContainText(
        "Discogs answered 403: check the Discogs token in Settings and that it belongs to your Discogs username.",
      );
      // A refused token is refused again, so no retry runs, however long the page waits.
      await app.clock.runFor(PUSH_RETRY_DELAYS_MS.reduce((sum, delayMs) => sum + delayMs, 0));
      expect(
        app.apiRequests().filter((request) => request.startsWith("POST /api/discogs/wantlist/")),
      ).toHaveLength(1);
      expect(fakes.requests("PUT /users/:user/wants/:id")).toEqual([
        expect.objectContaining({
          params: { user: DJ.username, id: releaseId },
          authenticatedAs: "other",
        }),
      ]);
      expect(fakes.wantlists.get(DJ.username)!.has(Number(releaseId))).toBe(false);
    },
  );
});

test.describe("with a Discogs account and the clock", () => {
  test.use({ diggaOptions: { ...ACCOUNT, clock: true } });

  test(
    "TRI-15 a push Discogs keeps failing is tried three more times, then stays saved in Digga, and Twelves marks it",
    { tag: ["@TRI-15", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const twelves = new TwelvesPage(app);
      app.expectProblems({ apiErrors: [/^POST \/api\/discogs\/wantlist\/\d+ answered 502$/] });
      fakes.fail("PUT /users/:user/wants/:id", { status: 500, times: 4 });
      await app.open();
      const key = await triage.currentKey();
      const releaseId = Number(await triage.record.getAttribute("data-release-id"));

      // Paused, each try waits for runFor(), and the slip names the wait it has armed.
      await app.clock.pause();
      await triage.judge("accepted");
      for (const delayMs of PUSH_RETRY_DELAYS_MS) {
        await expect(triage.lastAction).toContainText(`trying again in ${formatWait(delayMs)}.`);
        await app.clock.runFor(delayMs);
      }

      await expect(triage.lastAction).toContainText("Saved, but not on the Discogs wantlist.");
      await expect(triage.messages).toHaveText(
        / is not on the Discogs wantlist: .+\. A in Twelves tries again\.$/,
      );
      await expect(triage.messages).toContainText(FIRST_RECORD.title);
      expect(fakes.requests("PUT /users/:user/wants/:id")).toHaveLength(4);
      expect(fakes.wantlists.get(DJ.username)!.has(releaseId)).toBe(false);
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      expect(exported.verdicts).toContainEqual(
        expect.objectContaining({ key, status: "accepted" }),
      );

      await new HeaderPage(app).goTo("twelves");
      await twelves.showShelf("accepted");
      await expect(twelves.row("accepted", FIRST_RECORD.title)).toContainText(
        "not on your Discogs wantlist",
      );
    },
  );

  test(
    "TRI-45 a push Discogs fails once is tried again 5 s later and reaches the wantlist",
    { tag: ["@TRI-45", "@P1"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      app.expectProblems({ apiErrors: [/^POST \/api\/discogs\/wantlist\/\d+ answered 502$/] });
      fakes.fail("PUT /users/:user/wants/:id", { status: 500, times: 1 });
      await app.open();
      const releaseId = Number(await triage.record.getAttribute("data-release-id"));
      const [firstDelayMs] = PUSH_RETRY_DELAYS_MS;

      await app.clock.pause();
      await triage.judge("accepted");
      await expect(triage.lastAction).toContainText(
        `Not on your Discogs wantlist yet; trying again in ${formatWait(firstDelayMs!)}.`,
      );
      await app.clock.runFor(firstDelayMs!);

      await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      expect(fakes.requests("PUT /users/:user/wants/:id")).toHaveLength(2);
      expect(fakes.wantlists.get(DJ.username)!.has(releaseId)).toBe(true);
      await expect(triage.messages).toHaveText("");
    },
  );
});

test(
  "TRI-25 O opens the release on discogs.com and S a YouTube search for its artist and title",
  { tag: ["@TRI-25", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const key = await triage.currentKey();
    const artistAndTitle = `${FIRST_RECORD.artists.join(", ")} ${FIRST_RECORD.title}`;

    expect(await triage.openOnDiscogs()).toBe(discogsReleaseUrl(FIRST_RECORD.id));
    expect(await triage.searchYouTube()).toBe(youtubeSearchUrl(artistAndTitle));

    await expect(triage.record).toHaveAttribute("data-triage-key", key);
    expect(app.page.context().pages()).toEqual([app.page]);
  },
);
