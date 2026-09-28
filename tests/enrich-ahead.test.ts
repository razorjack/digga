import { describe, expect, it } from "vite-plus/test";
import { EnrichAhead } from "../src/client/triage/enrich-ahead.ts";
import type { ReleaseDetail } from "../src/shared/api.ts";
import type { ReleaseRecord } from "../src/shared/types.ts";
import { queueItem } from "./helpers/catalog.ts";

const detail = (id: number) => ({ release: { id } as ReleaseRecord }) as ReleaseDetail;

function harness() {
  const asked: number[] = [];
  const applied: number[] = [];
  const pending: (() => void)[] = [];
  const enrichAhead = new EnrichAhead({
    enrich: (releaseId) => {
      asked.push(releaseId);
      return new Promise((resolve) => pending.push(() => resolve(detail(releaseId))));
    },
    apply: (enriched) => applied.push(enriched.release.id),
  });
  const settle = async () => {
    pending.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { enrichAhead, asked, applied, settle };
}

describe("enrich ahead", () => {
  it("asks for one unenriched record at a time, each once", async () => {
    const { enrichAhead, asked, applied, settle } = harness();
    const enriched = { ...queueItem(2), enrichedAt: "2026-09-01T00:00:00.000Z" };
    enrichAhead.request([queueItem(1), enriched, queueItem(3)]);
    expect(asked).toEqual([1]);
    enrichAhead.request([queueItem(1), enriched, queueItem(3)]);
    await settle();
    expect(asked).toEqual([1, 3]);
    await settle();
    expect(applied).toEqual([1, 3]);
    enrichAhead.request([queueItem(3)]);
    expect(asked).toEqual([1, 3]);
  });

  it("forgets records that left the window before their turn", async () => {
    const { enrichAhead, asked, settle } = harness();
    enrichAhead.request([queueItem(1), queueItem(2)]);
    enrichAhead.request([queueItem(3)]);
    await settle();
    await settle();
    expect(asked).toEqual([1, 3]);
    enrichAhead.request([queueItem(2)]);
    expect(asked).toEqual([1, 3, 2]);
  });

  it("applies nothing after it stops", async () => {
    const { enrichAhead, applied, settle } = harness();
    enrichAhead.request([queueItem(1), queueItem(2)]);
    enrichAhead.stop();
    await settle();
    expect(applied).toEqual([]);
  });
});
