import { STATUS_COPY, type TriageStatus } from "../../../src/client/keymap.ts";
import {
  type DecisionsExport,
  type Stats,
  TWELVES_STATUSES,
  type TwelvesResponse,
} from "../../../src/shared/api.ts";
import { formatCount } from "../../../src/shared/display.ts";
import { isWantlistVerdict } from "../../../src/shared/wantlist.ts";
import { TriagePage } from "../pages/triage.ts";
import { expect, test } from "../support/test.ts";

test.describe("with a Discogs account", () => {
  test.use({
    diggaOptions: {
      template: "small-account",
      sandbox: false,
      savedToken: "e2e-token-dj",
      serviceUrls: {},
    },
  });

  test(
    "TRI-07 each verdict key saves its verdict, and wants reach the Discogs wantlist",
    { tag: ["@TRI-07", "@P0"] },
    async ({ app, fakes }) => {
      const triage = new TriagePage(app);
      const before = await app.api.get<Stats>("/api/stats");
      await app.open();
      const judged = new Map<string, TriageStatus>();
      const pushed: string[] = [];

      for (const status of ["rejected", "accepted", "candidate", "snoozed", "no_audio"] as const) {
        const key = await triage.currentKey();
        const releaseId = await triage.record.getAttribute("data-release-id");
        await triage.judge(status);
        judged.set(key, status);
        await expect(triage.lastAction).toContainText(STATUS_COPY[status]);
        await expect(triage.record).not.toHaveAttribute("data-triage-key", key);
        if (!isWantlistVerdict(status)) continue;
        pushed.push(releaseId!);
        await expect(triage.lastAction).toContainText("Added to your Discogs wantlist.");
      }

      const header = app.page.getByRole("banner");
      await expect(header).toContainText(`${formatCount(before.dug + 5)} dug`);
      await expect(header).toContainText("+5 this session");
      await app.page.reload();
      const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
      const saved = exported.verdicts.filter((verdict) => judged.has(verdict.key));
      expect(Object.fromEntries(saved.map((verdict) => [verdict.key, verdict.status]))).toEqual(
        Object.fromEntries(judged),
      );
      const shelved = await app.api.get<TwelvesResponse>(
        `/api/twelves?status=${TWELVES_STATUSES.join(",")}`,
      );
      const onShelves = shelved.items.filter((item) => judged.has(item.verdict.key));
      expect(onShelves.map((item) => item.verdict.status).toSorted()).toEqual([
        "accepted",
        "candidate",
        "no_audio",
        "snoozed",
      ]);
      expect(fakes.requests("PUT /users/:user/wants/:id").map((request) => request.params)).toEqual(
        pushed.map((id) => ({ user: "dj", id })),
      );
    },
  );
});

test(
  "TRI-10 Z walks back a verdict, a pass and a hidden label, one per press",
  { tag: ["@TRI-10", "@P0"] },
  async ({ app }) => {
    const triage = new TriagePage(app);
    await app.open();

    const hidden = await triage.currentKey();
    await triage.hideLabel();
    await expect(triage.lastAction).toContainText("label hidden");
    const passed = await triage.currentKey();
    await triage.pass();
    const judged = await triage.currentKey();
    await triage.judge("rejected");

    await triage.undoVerdict(judged);
    await expect(triage.record).toHaveAttribute("data-triage-key", judged);
    await expect(triage.lastAction).toContainText("undone");
    const exported = await app.api.get<DecisionsExport>("/api/export/decisions.json");
    expect(exported.verdicts.map((verdict) => verdict.key)).not.toContain(judged);

    await triage.undoPass(passed);
    await expect(triage.lastAction).toContainText("undone");

    await triage.undoLabel();
    await expect(triage.record).toHaveAttribute("data-triage-key", hidden);
    await expect(triage.lastAction).toContainText("undone");
  },
);
