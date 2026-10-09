import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { MAIN_PRESSING, SHOP_PRESSING } from "../fixtures/catalogue.ts";
import { TriagePage } from "../pages/triage.ts";
import { test, expect } from "../support/test.ts";

test.use({ diggaOptions: { template: "small", labels: [MAIN_PRESSING.label.name] } });

test(
  "TRI-48 shows another pressing's note until this pressing has its own",
  { tag: ["@TRI-48", "@P1"] },
  async ({ app }) => {
    await app.given.note(SHOP_PRESSING.id, "Check the repress for a different mix");
    const triage = new TriagePage(app);
    await app.open();
    await expect(triage.record).toHaveAttribute("data-release-id", String(MAIN_PRESSING.id));
    await expect(
      triage.root.getByText("Check the repress for a different mix", { exact: true }),
    ).toBeVisible();
    await expect(
      triage.root.getByText(`on ${SHOP_PRESSING.label.catno}`, { exact: true }),
    ).toBeVisible();

    await app.page.keyboard.press("e");
    await expect(triage.noteField).toHaveValue("");
    await triage.noteField.fill("This pressing has the original mix");
    await triage.noteField.press("Enter");
    await expect(app.page.getByRole("status", { name: "Note save status" })).toHaveText(
      "Note saved.",
    );
    await expect(
      triage.root.getByText("This pressing has the original mix", { exact: true }),
    ).toBeVisible();
    await expect(
      triage.root.getByText("Check the repress for a different mix", { exact: true }),
    ).toBeHidden();
    expect((await app.api.get<ReleaseDetail>(`/api/releases/${SHOP_PRESSING.id}`)).note).toBe(
      "Check the repress for a different mix",
    );
  },
);
