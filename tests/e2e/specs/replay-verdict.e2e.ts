import type { ReleaseDetail } from "../../../src/shared/api.ts";
import { FIRST_RECORD, triageKeyOf } from "../fixtures/catalogue.ts";
import { HeaderPage } from "../pages/header.ts";
import { isRequest, TriagePage } from "../pages/triage.ts";
import { TwelvesPage } from "../pages/twelves.ts";
import { expect, test } from "../support/test.ts";

test.use({ diggaOptions: { template: "small" } });

test(
  "TWL-30 replay undo retains a newer Twelves decision",
  { tag: ["@TWL-30", "@P1"] },
  async ({ app }) => {
    await app.given.verdict({
      key: triageKeyOf(FIRST_RECORD),
      releaseId: FIRST_RECORD.id,
      status: "snoozed",
    });
    const twelves = new TwelvesPage(app);
    const triage = new TriagePage(app);
    const header = new HeaderPage(app);
    await twelves.open();
    await twelves.hearAgain();
    await header.goTo("twelves");
    await twelves.rejudge("rejected");
    const refreshed = app.page.waitForResponse((response) =>
      isRequest(response, "GET", `/api/releases/${FIRST_RECORD.id}`),
    );
    await header.goTo("triage");
    await (await refreshed).finished();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    await triage.judge("no_audio");
    await triage.undoToPreviousVerdict();
    await expect(triage.record).toHaveAttribute("data-release-id", String(FIRST_RECORD.id));
    const detail = await app.api.get<ReleaseDetail>(`/api/releases/${FIRST_RECORD.id}`);
    expect(detail.verdict?.status).toBe("rejected");
  },
);
