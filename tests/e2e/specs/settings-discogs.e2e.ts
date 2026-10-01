import type { DiscogsAccountResponse } from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import type { Job } from "../../../src/shared/types.ts";
import { DJ, MAYBE_LIST, PUBLIC_LIST } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

// Settings and Discogs: the token, the requests a visit costs, the Maybe list and the import
// jobs (docs/E2E_TESTING.md, "Settings").

const ACCOUNT = { template: "small-account", savedToken: "e2e-token-dj" } as const;

/** A library that has not imported anything yet, with the username and token to import with. */
const READY_TO_IMPORT = {
  config: { discogs: { username: DJ.username } },
  savedToken: "e2e-token-dj",
} as const;

const COLLECTION_PAGE = "GET /users/:user/collection/folders/0/releases";

test(
  "SET-08 a token Discogs takes is saved with its account, a refused one is not, Remove removes it",
  { tag: ["@SET-08", "@P1"] },
  async ({ app }) => {
    app.expectProblems({ apiErrors: [/^PUT \/api\/discogs\/token answered 400$/] });
    const settings = new SettingsPage(app);
    await settings.open();
    await expect(settings.token).toHaveAccessibleDescription(/^No Discogs token is set\. /);

    const saved = await settings.saveToken("e2e-token-dj");
    expect(saved.status()).toBe(200);
    await expect(settings.root.getByText("Token saved.", { exact: true })).toBeVisible();
    await expect(settings.token).toHaveAccessibleDescription(/^Works for dj\. /);
    // The first token sets the username, and the form takes it, so a later save keeps it.
    await expect(settings.username).toHaveValue(DJ.username);
    await expect(settings.saveButton).toBeDisabled();

    const refused = await settings.saveToken("e2e-token-refused");
    expect(refused.status()).toBe(400);
    await expect(settings.token).toHaveAttribute("aria-invalid", "true");
    await expect(settings.token).toHaveAccessibleDescription(
      /^Not saved: Discogs refused this token; copy it again from discogs\.com\. /,
    );
    expect(await app.api.get<DiscogsAccountResponse>("/api/discogs/account")).toMatchObject({
      tokenSource: "saved",
      tokenUsername: DJ.username,
    });

    const removed = await settings.saveToken(null);
    expect(removed.status()).toBe(200);
    await expect(settings.root.getByText("Token removed.", { exact: true })).toBeVisible();
    await expect(settings.token).not.toHaveAttribute("aria-invalid");
    await expect(settings.token).toHaveAccessibleDescription(/^No Discogs token is set\. /);
    expect(await app.api.get<DiscogsAccountResponse>("/api/discogs/account")).toMatchObject({
      hasToken: false,
      tokenSource: null,
      username: DJ.username,
    });
  },
);

test.describe("with a token from the environment", () => {
  test.use({ diggaOptions: { template: "small-account", environmentToken: "e2e-token-dj" } });

  test(
    "SET-09 a token from the environment disables the field with the hint, and the server refuses another",
    { tag: ["@SET-09", "@P1"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      await settings.open();

      await expect(settings.token).toBeDisabled();
      await expect(settings.saveTokenButton).toBeDisabled();
      await expect(settings.discogs.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await expect(settings.token).toHaveAccessibleDescription(
        /^Works for dj, from DISCOGS_TOKEN in the environment\. DISCOGS_TOKEN in the environment, or in the \.env digga started with, overrides a saved token; remove it there to change the token here\.$/,
      );
      await expect(
        app.api.send("PUT", "/api/discogs/token", { token: "e2e-token-other" }),
      ).rejects.toThrow(/answered 409: .*DISCOGS_TOKEN is set in the environment/);
      expect(await app.api.get<DiscogsAccountResponse>("/api/discogs/account")).toMatchObject({
        tokenSource: "environment",
        tokenUsername: DJ.username,
      });
    },
  );
});

test.describe("with a Discogs account", () => {
  test.use({ diggaOptions: ACCOUNT });

  test(
    "SET-10 opening Settings costs two Discogs requests, the account and its lists, as the page says",
    { tag: ["@SET-10", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      // The saved token's given state has asked Discogs whose it is already.
      const mark = fakes.log.length;
      await settings.open();
      await expect(settings.token).toHaveAccessibleDescription(/^Works for dj\. /);
      await expect(settings.listsButton).toHaveText("Reload lists");

      const requests = fakes.log
        .slice(mark)
        .filter((request) => request.service === "discogs")
        .map((request) => `${request.method} ${request.path}`);
      expect(requests.toSorted()).toEqual([
        "GET /oauth/identity",
        `GET /users/${DJ.username}/lists`,
      ]);
      await settings.discogs.getByText("Every request Digga makes", { exact: true }).click();
      await expect(settings.discogs.getByRole("listitem").first()).toContainText(
        "About two requests a visit.",
      );
    },
  );

  test(
    "SET-11 Read my lists offers the private and public lists; the chosen one enables M and loads with the page",
    { tag: ["@SET-11", "@P1"] },
    async ({ app, fakes }) => {
      app.expectProblems({ apiErrors: [/^GET \/api\/discogs\/lists answered 502$/] });
      const settings = new SettingsPage(app);
      const header = new HeaderPage(app);
      fakes.fail("GET /users/:user/lists", { status: 500, times: 1 });
      await settings.open();

      await expect(settings.maybeList).toHaveAccessibleDescription(
        "Lists did not load: Discogs answered 500.",
      );
      await expect(settings.listsButton).toHaveText("Read my lists");
      await settings.readLists();
      await expect(settings.listsButton).toHaveText("Reload lists");
      await expect(settings.maybeList.getByRole("option")).toHaveText([
        "None: no M verdict",
        `${MAYBE_LIST.name} (private)`,
        PUBLIC_LIST.name,
      ]);

      await settings.maybeList.selectOption({ label: `${MAYBE_LIST.name} (private)` });
      await settings.save();
      expect((await app.api.get<Config>("/api/settings")).discogs.maybeListId).toBe(MAYBE_LIST.id);
      await header.goTo("triage");
      await expect(new TriagePage(app).verdictButton("maybe")).toBeVisible();

      const lists = app.page.waitForResponse((response) =>
        response.url().endsWith("/api/discogs/lists"),
      );
      await header.goTo("settings");
      expect((await lists).ok()).toBe(true);
      await expect(settings.listsButton).toHaveText("Reload lists");
      await expect(settings.maybeList).toHaveValue(String(MAYBE_LIST.id));
      await expect(settings.maybeList.getByRole("option")).toHaveCount(3);
    },
  );
});

test.describe("with an account to import", () => {
  test.use({ diggaOptions: READY_TO_IMPORT });

  test(
    "SET-13 the collection and wantlist imports run as jobs, end done with their counts, and fill Twelves",
    { tag: ["@SET-13", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const twelves = new TwelvesPage(app);
      const page = fakes.hold(COLLECTION_PAGE);
      await settings.open();
      await expect(settings.library).toContainText("Discogs wantlist 0, owned 0");

      const collection = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Collection" }),
      );
      await expect(
        settings.root.getByText("Import collection started.", { exact: true }),
      ).toBeVisible();
      await page.received;
      // Held at the fake, the job cannot end before the row has shown it running.
      await settings.waitForJob(collection, "running");
      page.release();
      await settings.waitForJob(collection, "done");
      await expect(settings.job(collection)).toContainText("Import collection");
      await expect(settings.job(collection)).toContainText(
        `page 1 of 1, ${DJ.collection.length} items`,
      );

      const wantlist = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Wantlist" }),
      );
      await settings.waitForJob(wantlist, "done");
      await expect(settings.job(wantlist)).toContainText(
        `page 1 of 1, ${DJ.wantlist.length} items`,
      );
      await expect(settings.library).toContainText(
        `Discogs wantlist ${DJ.wantlist.length}, owned ${DJ.collection.length}`,
      );

      await new HeaderPage(app).goTo("twelves");
      await twelves.showShelf("collection");
      await expect(twelves.row("collection", "Night Shift")).toBeVisible();
      await twelves.showShelf("wantlist");
      await expect(twelves.row("wantlist", "Day Break")).toBeVisible();
    },
  );

  test(
    "SET-14 a cancelled import reads running until its page in flight returns, then cancelled",
    { tag: ["@SET-14", "@P1"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const page = fakes.hold(COLLECTION_PAGE);
      await settings.open();
      const collection = await settings.startJob(
        settings.jobs.getByRole("button", { name: "Collection" }),
      );
      await page.received;

      await settings.cancelJob(collection);
      await expect(settings.jobStatus(collection, "running")).toBeVisible();
      expect((await app.api.get<Job>(`/api/jobs/${collection}`)).status).toBe("running");

      page.release();
      await settings.waitForJob(collection, "cancelled");
      await expect(settings.job(collection).getByRole("button", { name: "Cancel" })).toHaveCount(0);
      expect(fakes.requests(COLLECTION_PAGE)).toHaveLength(1);
    },
  );
});
