import type { TwelvesResponse } from "../../../src/shared/api.ts";
import {
  DJ,
  FIRST_RECORD,
  PROMO_PRESSING,
  REMIX_PROMO_PRESSING,
  WHITE_LABEL_PRESSING,
  triageKeyOf,
} from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { SettingsPage } from "../pages/settings.ts";
import { TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { test, expect } from "../support/test.ts";

test.use({
  diggaOptions: {
    template: "small",
    savedToken: "e2e-token-dj",
    config: { discogs: { username: DJ.username } },
  },
});

test(
  "TWL-32 expands an imported want, reviews uncertain tracks, and preserves a manual pressing on undo",
  { tag: ["@TWL-32", "@P1"] },
  async ({ app, fakes }) => {
    test.setTimeout(60_000);
    fakes.wantlists.get(DJ.username)!.set(FIRST_RECORD.id, "Retail wanted manually");
    const settings = new SettingsPage(app);
    await settings.open("discogs");
    const imported = await settings.startJob(
      settings.imports.getByRole("button", { name: "Import wantlist", exact: true }),
    );
    await settings.waitForJob(imported, "done");
    // This later Discogs addition is deliberately absent from the imported memberships.
    fakes.wantlists.get(DJ.username)!.set(WHITE_LABEL_PRESSING.id, "Keep this manual note");
    await new HeaderPage(app).goTo("twelves");
    const twelves = new TwelvesPage(app);
    await twelves.showShelf("wantlist");
    await twelves.filterBy(FIRST_RECORD.title);
    await app.page.getByRole("button", { name: "Alternatives for 1 filtered records…" }).click();
    const dialog = app.page.getByRole("dialog", { name: "Add alternative pressings", exact: true });
    await expect(dialog.getByRole("status")).toHaveText(
      "Preview ready. Existing wants will be kept.",
      { timeout: 20_000 },
    );
    const whiteLabel = dialog.getByRole("checkbox", {
      name: `${WHITE_LABEL_PRESSING.title} (${WHITE_LABEL_PRESSING.id})`,
      exact: true,
    });
    const promo = dialog.getByRole("checkbox", {
      name: `${PROMO_PRESSING.title} (${PROMO_PRESSING.id})`,
      exact: true,
    });
    const remix = dialog.getByRole("checkbox", {
      name: `${REMIX_PROMO_PRESSING.title} (${REMIX_PROMO_PRESSING.id})`,
      exact: true,
    });
    await expect(whiteLabel).toBeChecked();
    await expect(promo).toBeChecked();
    await expect(remix).not.toBeChecked();
    await expect(remix).toHaveAccessibleDescription(/Review: different or incomplete tracklist/);
    const promoWrite = fakes.hold("PUT /users/:user/wants/:id");
    await dialog.getByRole("button", { name: "Add 2 selected pressings" }).click();
    await promoWrite.received;
    const meter = dialog.getByRole("progressbar", { name: "Adding the selected pressings" });
    await expect(dialog.getByRole("status")).toHaveText(
      "Adding the selected pressings to Discogs: 1 of 2…",
    );
    await expect(meter).toHaveAttribute("value", "1");
    await expect(meter).toHaveAttribute("max", "2");
    promoWrite.release();
    await expect(dialog.getByRole("status")).toHaveText(/Selected pressings are on your wantlist/, {
      timeout: 20_000,
    });
    await expect(meter).toBeHidden();
    await expect(dialog.getByText("1 added, 1 already on your wantlist.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(twelves.records.filter({ hasText: FIRST_RECORD.title })).toHaveCount(1);
    await expect(twelves.records.filter({ hasText: FIRST_RECORD.title })).toContainText(
      "3 wanted pressings",
    );
    await app.page.keyboard.press("z");
    await expect(twelves.messages).toHaveText("Additions undone. Your existing wants were kept.", {
      timeout: 10_000,
    });
    expect(fakes.wantlists.get(DJ.username)!.get(FIRST_RECORD.id)).toBe("Retail wanted manually");
    expect(fakes.wantlists.get(DJ.username)!.get(WHITE_LABEL_PRESSING.id)).toBe(
      "Keep this manual note",
    );
    expect(fakes.wantlists.get(DJ.username)!.has(PROMO_PRESSING.id)).toBe(false);
    expect(fakes.wantlists.get(DJ.username)!.has(REMIX_PROMO_PRESSING.id)).toBe(false);
    const item = (await app.api.get<TwelvesResponse>("/api/twelves")).items.find(
      (item) => item.key === triageKeyOf(FIRST_RECORD),
    );
    expect(item?.membership.wantlistReleaseIds.toSorted((left, right) => left - right)).toEqual(
      [FIRST_RECORD.id, WHITE_LABEL_PRESSING.id].toSorted((left, right) => left - right),
    );
  },
);

test(
  "TRI-51 saved settings add matching alternative pressings and undo keeps an existing manual want",
  { tag: ["@TRI-51", "@P1"] },
  async ({ app, fakes }) => {
    test.setTimeout(60_000);
    fakes.wantlists.get(DJ.username)!.set(WHITE_LABEL_PRESSING.id, "Manual note");
    const settings = new SettingsPage(app);
    await settings.open("discogs");
    const group = settings.root.getByRole("group", {
      name: "Also add alternative pressings to Discogs",
    });
    await expect(group.getByRole("checkbox", { name: "White labels" })).not.toBeChecked();
    await group.getByRole("checkbox", { name: "White labels" }).check();
    await group.getByRole("checkbox", { name: "Promos", exact: true }).check();
    await settings.save("stays");
    await new HeaderPage(app).goTo("triage");
    const triage = new TriagePage(app);
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await triage.judge("accepted");
    await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.", {
      timeout: 25_000,
    });
    expect(fakes.wantlists.get(DJ.username)!.has(PROMO_PRESSING.id)).toBe(true);
    expect(fakes.wantlists.get(DJ.username)!.has(REMIX_PROMO_PRESSING.id)).toBe(false);
    await triage.undoVerdict(triageKeyOf(FIRST_RECORD));
    await expect(triage.messages).toHaveText("Removed from your Discogs wantlist.", {
      timeout: 15_000,
    });
    expect(fakes.wantlists.get(DJ.username)!.get(WHITE_LABEL_PRESSING.id)).toBe("Manual note");
    expect(fakes.wantlists.get(DJ.username)!.has(FIRST_RECORD.id)).toBe(false);
    expect(fakes.wantlists.get(DJ.username)!.has(PROMO_PRESSING.id)).toBe(false);
  },
);
