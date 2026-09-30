import type { QueueResponse, Stats } from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test(
  "SHELL-01 a loaded library opens on Triage with its counts and first record",
  { tag: ["@SHELL-01", "@P0"] },
  async ({ app }) => {
    const stats = await app.api.get<Stats>("/api/stats");
    const queue = await app.api.get<QueueResponse>("/api/queue?limit=1");
    const first = queue.items[0]!;
    const triage = new TriagePage(app);

    await app.open();

    await expect(app.page).toHaveTitle("Triage – Digga");
    const header = app.page.getByRole("banner");
    await expect(header).toContainText(`${formatCount(stats.dug)} dug`);
    await expect(header).toContainText(`${formatCount(stats.remaining)} to go`);
    await expect(triage.record).toHaveAttribute("data-triage-key", first.triageKey);
    await expect(triage.record.getByRole("heading", { level: 1 })).toHaveText(first.artistDisplay);
  },
);
