import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small" } });

test(
  "TRI-50 clicking a verdict saves the open note on its original record",
  { tag: ["@TRI-50", "@P1"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();
    const key = await triage.currentKey();
    const releaseId = await triage.record.getAttribute("data-release-id");
    await triage.openNote();
    await triage.noteField.fill("Remember this radio tune");
    const saved = app.page.waitForResponse((response) =>
      isRequest(response, "POST", "/api/verdicts"),
    );
    await triage.verdictButton("snoozed").click();
    expect((await saved).ok()).toBe(true);
    await (await saved).finished();
    await expect(triage.lastAction).not.toHaveAttribute("aria-busy", "true");
    await triage.undoVerdict(key);
    await expect(triage.root.getByText("Remember this radio tune", { exact: true })).toBeVisible();
    const detail = await app.api.get<ReleaseDetail>(`/api/releases/${releaseId}`);
    expect(detail.note).toBe("Remember this radio tune");
    expect(detail.verdict).toBeNull();
    await triage.openNote();
    await triage.noteField.fill("Discard this edit");
    await triage.cancelNote();
    await app.page.reload();
    await expect(triage.root.getByText("Remember this radio tune", { exact: true })).toBeVisible();
  },
);
