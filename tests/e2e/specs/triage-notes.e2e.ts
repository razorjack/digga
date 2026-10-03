import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test(
  "TRI-46 a note survives reload without a verdict",
  { tag: ["@TRI-46", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    await expect(triage.record).toBeVisible();
    const id = await triage.record.getAttribute("data-release-id");
    await app.page.keyboard.press("e");
    await triage.noteField.fill("Check the B side after dinner");
    await triage.noteField.press("Enter");
    await expect(app.page.getByRole("status", { name: "Note save status" })).toHaveText(
      "Note saved.",
    );
    await app.page.reload();
    await expect(triage.record).toHaveAttribute("data-release-id", id!);
    await expect(triage.root).toContainText("Check the B side after dinner");
    const detail = await app.api.get<ReleaseDetail>(`/api/releases/${id}`);
    expect(detail.note).toBe("Check the B side after dinner");
    expect(detail.verdict).toBeNull();
  },
);
