import { SHOP_KEYS } from "../../../src/client/keymap.ts";
import { discogsListingUrl } from "../../../src/shared/discogs-urls.ts";
import type { ShoppingResponse } from "../../../src/shared/shopping.ts";
import { NOT_IN_ANY_DUMP, SHOPKEEPER, SHOP_PRESSING } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { expectAccessible } from "../support/axe.ts";
import type { DiggaApp } from "../support/app.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small-account", savedToken: "e2e-token-dj" } });

async function shoppingDecision(app: DiggaApp, key: string): Promise<void> {
  const saved = app.page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().includes("/api/shopping/"),
  );
  await app.page.keyboard.press(key.toLowerCase());
  const response = await saved;
  expect(response.ok()).toBe(true);
  await response.finished();
  await expect(app.page.getByRole("region", { name: "Shopping review" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

test(
  "SHOP-01 discovers shopping from Twelves, reads a seller and reviews a persistent shortlist",
  { tag: ["@SHOP-01", "@P0"] },
  async ({ app }, testInfo) => {
    await app.api.send("POST", `/api/discogs/wantlist/${SHOP_PRESSING.id}`);
    await app.open("#/twelves");
    await app.page.getByRole("link", { name: /Shop my wants/ }).click();
    await expect(app.page.getByRole("heading", { name: "Shop my wants" })).toBeVisible();
    await app.page.getByLabel("Read a seller’s shop").fill(SHOPKEEPER.username);
    await app.page.getByRole("button", { name: "Read shop", exact: true }).click();
    const review = app.page.getByRole("region", { name: "Shopping review" });
    const copies = app.page.getByRole("complementary", { name: "Shopping copies" });
    await expect(copies.getByRole("button")).toHaveCount(2);
    const first = review.locator("[data-listing-id]");
    await expect(first).toBeVisible();
    const firstId = Number(await first.getAttribute("data-listing-id"));
    const sellerId = Number(await app.page.getByLabel("Seller", { exact: true }).inputValue());
    await review.getByRole("button", { name: /Shortlist & next/ }).click();
    await expect(first).not.toHaveAttribute("data-listing-id", String(firstId));
    await shoppingDecision(app, SHOP_KEYS.keep);
    await app.page.getByRole("radio", { name: /^Shortlist / }).check();
    await expect(review.getByRole("button", { name: /Keep & next/ })).toBeEnabled();
    await expect(app.page.getByLabel("Shortlist subtotal")).toContainText("4.50");
    await expect(review.getByRole("list", { name: "Tracklist" })).toBeVisible();
    await expectAccessible(app.page, "Shopping shortlist");
    await app.page.screenshot({ path: testInfo.outputPath("shopping.png"), fullPage: true });
    await shoppingDecision(app, SHOP_KEYS.keep);
    await shoppingDecision(app, SHOP_KEYS.skip);
    await expect(app.page.getByLabel("Shortlist subtotal")).toContainText("1 shortlisted");
    await shoppingDecision(app, SHOP_KEYS.undo);
    await expect(app.page.getByLabel("Shortlist subtotal")).toContainText("2 shortlisted");
    const selectedId = Number(await first.getAttribute("data-listing-id"));
    expect(await app.expectExternalOpen(() => app.page.keyboard.press("o"))).toBe(
      discogsListingUrl(selectedId),
    );
    const saved = await app.api.get<ShoppingResponse>(`/api/shopping/${sellerId}`);
    expect(saved.items.every((item) => item.state === "shortlisted")).toBe(true);
    expect(new Set(saved.items.map((item) => item.release.id))).toEqual(
      new Set([SHOP_PRESSING.id, NOT_IN_ANY_DUMP.id]),
    );
    await app.relaunch();
    await app.open(`#/shop/${sellerId}`);
    await app.page.getByRole("radio", { name: /^Shortlist / }).check();
    await expect(app.page.getByLabel("Shortlist subtotal")).toContainText("2 shortlisted");
    await expect(
      app.page.getByRole("complementary", { name: "Shopping copies" }).getByRole("button"),
    ).toHaveCount(2);
  },
);

test(
  "SHOP-02 failed save keeps the copy and keyboard playback belongs to Shop",
  { tag: ["@SHOP-02", "@P1"] },
  async ({ app }) => {
    await app.given.sellerShop(SHOPKEEPER.username);
    await app.api.send("POST", `/api/discogs/wantlist/${SHOP_PRESSING.id}`);
    await app.open();
    await new HeaderPage(app).goTo("shop");
    const option = app.page.getByRole("option", { name: /shopkeeper/ });
    await expect(option).toBeAttached();
    const sellerId = (await option.getAttribute("value"))!;
    await app.page.getByLabel("Seller", { exact: true }).selectOption(sellerId);
    const review = app.page.getByRole("region", { name: "Shopping review" });
    const copies = app.page.getByRole("complementary", { name: "Shopping copies" });
    await copies.getByRole("button", { name: new RegExp(SHOP_PRESSING.title) }).click();
    const record = review.locator("[data-listing-id]");
    await expect(record).toHaveAttribute("data-release-id", String(SHOP_PRESSING.id));
    await expect(review.getByRole("list", { name: "Tracklist" })).toBeVisible();
    await app.page.keyboard.press("Space");
    await expect(
      review.getByRole("region", { name: "Player" }).getByText("playing", { exact: true }),
    ).toBeVisible();
    const listingId = await record.getAttribute("data-listing-id");
    app.expectProblems({
      aborted: [/^PUT \/api\/shopping\//],
      consoleErrors: [/Failed to load resource/],
    });
    const fault = await app.abortRequests({
      method: "PUT",
      path: `/api/shopping/${sellerId}/${listingId}`,
    });
    await app.page.keyboard.press(SHOP_KEYS.keep.toLowerCase());
    await expect(app.page.getByRole("alert")).toContainText("Not saved:");
    await expect(record).toHaveAttribute("data-listing-id", listingId!);
    await expect(app.page.getByLabel("Shortlist subtotal")).toContainText("0 shortlisted");
    await fault.lift();
    await shoppingDecision(app, SHOP_KEYS.keep);
    expect(
      app.apiRequests().filter((request) => request.startsWith("POST /api/verdicts")),
    ).toHaveLength(0);
  },
);
