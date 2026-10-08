import { SHELVES } from "../../../src/client/twelves/model.ts";
import type { DiscogsAccountResponse, QueueResponse } from "../../../src/shared/api.ts";
import type { Config } from "../../../src/shared/config.ts";
import { formatPrice } from "../../../src/shared/display.ts";
import type { Job } from "../../../src/shared/types.ts";
import { MARKET } from "../../../tools/dev/fake-services.ts";
import {
  DJ,
  IN_COLLECTION,
  MAYBE_LIST,
  ON_WANTLIST,
  PUBLIC_LIST,
  SHOPKEEPER,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

// Settings and Discogs: the token, the requests a visit costs, the Maybe list and the import
// jobs (docs/e2e/scenarios/settings.md).

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
    await settings.open("discogs");
    await expect(settings.token).toHaveAccessibleDescription(/^No Discogs token is set\. /);

    const saved = await settings.saveToken("e2e-token-dj");
    expect(saved.status()).toBe(200);
    await expect(settings.root.getByText("Token saved.", { exact: true })).toBeVisible();
    await expect(settings.token).toHaveAccessibleDescription(/^Works for dj\. /);
    // The first token sets the username, and the form takes it, so a later save keeps it.
    await expect(settings.username).toHaveValue(DJ.username);
    await expect(settings.saveButton).toBeHidden();

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
      await settings.open("discogs");

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
      await settings.open("discogs");
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
      await settings.open("discogs");

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
      // The server reads the saved username's lists, so a typed one waits for Save.
      const savedUsername = await settings.username.inputValue();
      await settings.username.fill("someone-else");
      await expect(settings.listsButton).toBeDisabled();
      await expect(settings.listsButton).toHaveAccessibleDescription(
        "Save the username first: Digga reads the lists of the saved one.",
      );
      await settings.username.fill(savedUsername);
      await expect(settings.listsButton).toBeEnabled();

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
      await settings.showTab("discogs");
      await expect(settings.listsButton).toHaveText("Reload lists");
      await expect(settings.maybeList).toHaveValue(String(MAYBE_LIST.id));
      await expect(settings.maybeList.getByRole("option")).toHaveCount(3);
    },
  );

  test(
    "SET-22 Settings forgets the Discogs account's data, after which the library holds none of it and takes another account",
    { tag: ["@SET-22", "@P2"] },
    async ({ app }) => {
      app.expectProblems({ apiErrors: [/^PUT \/api\/discogs\/token answered 409$/] });
      const settings = new SettingsPage(app);
      const twelves = new TwelvesPage(app);
      // Owned and on the wantlist, the account's records are out of the queue.
      const held = [triageKeyOf(IN_COLLECTION), triageKeyOf(ON_WANTLIST)];
      const queuedBefore = await keysInQueue(app);
      for (const key of held) expect(queuedBefore).not.toContain(key);
      await settings.open("discogs");
      await expect(settings.username).toHaveAccessibleDescription(
        /The library holds dj's collection, wantlist and Maybe list; forget them to use another account\./,
      );

      const refused = await settings.saveToken("e2e-token-other");
      expect(refused.status()).toBe(409);
      await expect(settings.token).toHaveAccessibleDescription(
        /^Not saved: This library holds the Discogs collection and wantlist of dj; forget them in Settings before using other\. /,
      );

      expect(await settings.forgetDiscogsData()).toBe(
        "confirm: Forget the collection, wantlist and Maybe list of dj in Digga? Verdicts, notes and marks stay, and Discogs keeps the account as it is.",
      );
      // The collection, and the wantlist with its release no dump has.
      await expect(
        settings.root.getByText("Forgot 3 Discogs items of dj.", { exact: true }),
      ).toBeVisible();
      await expect(settings.discogs.getByRole("button", { name: "Forget them" })).toHaveCount(0);
      expect(await app.api.get<DiscogsAccountResponse>("/api/discogs/account")).toMatchObject({
        username: DJ.username,
        dataAccount: null,
      });
      expect(await keysInQueue(app)).toEqual(expect.arrayContaining(held));

      const saved = await settings.saveToken("e2e-token-other");
      expect(saved.status()).toBe(200);
      await expect(settings.token).toHaveAccessibleDescription(
        /^The token belongs to other, not dj\. /,
      );
      await twelves.open();
      for (const shelf of ["wantlist", "collection"] as const)
        await expect(twelves.shelfOption(shelf)).toHaveAccessibleName(
          `${SHELVES.find((candidate) => candidate.id === shelf)!.label} 0`,
        );
    },
  );

  test(
    "SET-15 Maybe list waits for a saved list, Read shop reads a seller for F",
    { tag: ["@SET-15", "@P2"] },
    async ({ app }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      const maybeList = settings.imports.getByRole("button", { name: "Maybe list", exact: true });
      const readShop = settings.imports.getByRole("button", { name: "Read shop" });
      await settings.open("discogs");

      await expect(
        settings.imports.getByRole("group", { name: "Your Discogs" }).getByRole("button"),
      ).toHaveText(["Collection", "Wantlist", "Maybe list"]);
      await expect(maybeList).toBeDisabled();
      await expect(settings.listsButton).toHaveText("Reload lists");
      await settings.maybeList.selectOption({ label: `${MAYBE_LIST.name} (private)` });
      await expect(maybeList).toBeDisabled();
      await settings.save();
      await expect(maybeList).toBeEnabled();

      await expect(readShop).toBeDisabled();
      await settings.imports
        .getByRole("textbox", { name: "Seller's Discogs username" })
        .fill(SHOPKEEPER.username);
      const shop = await settings.startJob(readShop);
      await settings.waitForJob(shop, "done");

      await new HeaderPage(app).goTo("triage");
      await triage.openScopePicker();
      await triage.searchScopes("shop");
      await expect(
        triage.scopePicker.getByRole("radio", { name: `${SHOPKEEPER.username} seller, 1 record` }),
      ).toBeVisible();
      await triage.closeScopePicker();
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
      await settings.open("library");
      await expect(settings.libraryCount("on the Discogs wantlist")).toHaveText(
        "0 on the Discogs wantlist",
      );
      await expect(settings.libraryCount("owned")).toHaveText("0 owned");
      await settings.showTab("discogs");

      const collection = await settings.startJob(
        settings.imports.getByRole("button", { name: "Collection" }),
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
        settings.imports.getByRole("button", { name: "Wantlist" }),
      );
      await settings.waitForJob(wantlist, "done");
      await expect(settings.job(wantlist)).toContainText(
        `page 1 of 1, ${DJ.wantlist.length} items`,
      );
      await settings.showTab("library");
      await expect(settings.libraryCount("on the Discogs wantlist")).toHaveText(
        `${DJ.wantlist.length} on the Discogs wantlist`,
      );
      await expect(settings.libraryCount("owned")).toHaveText(`${DJ.collection.length} owned`);

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
      await settings.open("discogs");
      const collection = await settings.startJob(
        settings.imports.getByRole("button", { name: "Collection" }),
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

test.describe("with a token", () => {
  test.use({ diggaOptions: { savedToken: "e2e-token-dj" } });

  test(
    "SET-12 P asks Discogs in the chosen currency and shows its symbol",
    { tag: ["@SET-12", "@P2"] },
    async ({ app, fakes }) => {
      const settings = new SettingsPage(app);
      const triage = new TriagePage(app);
      await settings.open("discogs");
      await expect(settings.currency).toHaveValue("EUR");

      await settings.currency.selectOption("GBP");
      await settings.save();
      await new HeaderPage(app).goTo("triage");
      const releaseId = await triage.record.getAttribute("data-release-id");
      await triage.askMarket();

      expect(fakes.requests("GET /releases/:id")).toEqual([
        expect.objectContaining({ params: { id: releaseId }, query: { curr_abbr: "GBP" } }),
      ]);
      await expect(triage.market).toContainText(formatPrice(MARKET.lowestPrice, "GBP"));
      await expect(triage.market).toContainText("£");
    },
  );
});

/** Every record to dig under the saved filters, by triage key. */
async function keysInQueue(app: DiggaApp): Promise<string[]> {
  return (await app.api.get<QueueResponse>("/api/queue?limit=100")).items.map(
    (item) => item.triageKey,
  );
}
