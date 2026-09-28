import { describe, expect, it } from "vite-plus/test";
import { type Api, createAppApi } from "../src/client/api.ts";
import { TriageSession } from "../src/client/triage/session.svelte.ts";
import type { QueueItem, ReleaseDetail, TwelvesItem, VerdictInput } from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { ReleaseRecord, Verdict } from "../src/shared/types.ts";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls instead of sleeping a fixed time, so a busy machine cannot reorder the timers. */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await wait(2);
  }
}

function queueItem(id: number): QueueItem {
  return {
    id,
    triageKey: `r:${id}`,
    masterId: null,
    title: `Title ${id}`,
    artistDisplay: `Artist ${id}`,
    labelName: null,
    catno: null,
    year: 2000,
    country: null,
    formatSummary: "Vinyl",
    styles: [],
    videoCount: 0,
    communityWant: null,
    communityHave: null,
    numForSale: null,
    lowestPrice: null,
    currency: null,
    enrichedAt: null,
  };
}

/** A server stand-in that records the writes the session makes. */
function fakeServer(queue: number[]) {
  const calls: string[] = [];
  const verdicts = new Map<string, Verdict>();
  const state = { pushDelayMs: 0 };
  const http = {
    mode: "live",
    getQueue: async () => ({
      items: queue.map(queueItem).filter((i) => !verdicts.has(i.triageKey)),
      remaining: 0,
      strategy: "label_sweep",
      seed: null,
      filters: DEFAULT_CONFIG.filters,
    }),
    getRelease: async (id: number): Promise<ReleaseDetail> => ({
      release: { id, triageKey: `r:${id}` } as ReleaseRecord,
      tracks: [],
      videos: [],
      verdict: verdicts.get(`r:${id}`) ?? null,
      trackVerdicts: [],
      siblings: [],
    }),
    postVerdict: async (input: VerdictInput) => {
      calls.push(
        `verdict ${input.key} ${input.status}${input.decidedAt ? ` ${input.decidedAt}` : ""}`,
      );
      const v: Verdict = {
        key: input.key,
        status: input.status,
        source: input.source ?? "triage",
        notes: input.notes ?? null,
        releaseId: input.releaseId ?? null,
        decidedAt: input.decidedAt ?? new Date().toISOString(),
      };
      verdicts.set(input.key, v);
      return v;
    },
    deleteVerdict: async (key: string) => {
      calls.push(`forget ${key}`);
      const previous = verdicts.get(key) ?? null;
      verdicts.delete(key);
      return { deleted: previous !== null, previous };
    },
    pushToWantlist: async (id: number) => {
      calls.push(`put ${id}`);
      await wait(state.pushDelayMs);
      return { releaseId: id, ok: true };
    },
    removeFromWantlist: async (id: number) => {
      calls.push(`remove ${id}`);
      return { releaseId: id, ok: true };
    },
  } as unknown as Api;
  const app = createAppApi(http, (inner) => inner);
  return { app, calls, verdicts, state };
}

async function started(queue: number[], pushGraceMs = 0) {
  const server = fakeServer(queue);
  const session = new TriageSession(server.app, { pushGraceMs });
  await session.start(50);
  return { ...server, session };
}

const snoozed = (id: number, decidedAt: string): TwelvesItem => ({
  verdict: {
    key: `r:${id}`,
    status: "snoozed",
    source: "triage",
    notes: "check the flip",
    releaseId: id,
    decidedAt,
  },
  release: queueItem(id),
  onWantlist: false,
});

describe("triage session", () => {
  it("cancels the wantlist push when the want is undone during the grace period", async () => {
    const { session, calls } = await started([1, 2], 40);
    session.judge("accepted");
    await wait(5);
    session.undo();
    await wait(80);
    expect(calls).toEqual(["verdict r:1 accepted", "forget r:1"]);
    expect(session.current?.id).toBe(1);
  });

  it("takes an undone want off the wantlist once it was pushed", async () => {
    const { session, calls } = await started([1, 2]);
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    session.undo();
    await until(() => calls.includes("remove 1"));
    await wait();
    // The verdict and the wantlist are written on separate chains; only the set matters.
    expect(calls.toSorted()).toEqual(["forget r:1", "put 1", "remove 1", "verdict r:1 accepted"]);
  });

  it("ends on the wantlist after A, Z and A while the first push is slow", async () => {
    const { session, calls, state } = await started([1, 2]);
    state.pushDelayMs = 40;
    session.judge("accepted");
    await wait(10);
    session.undo();
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    await wait(60);
    expect(calls.filter((c) => c.startsWith("put") || c.startsWith("remove"))).toEqual(["put 1"]);
    expect(session.slip).toMatchObject({ kind: "verdict", push: "done" });
  });

  it("does not push a want that was re-judged elsewhere during the grace period", async () => {
    const { session, calls, verdicts } = await started([1, 2], 30);
    session.judge("accepted");
    await wait(5);
    verdicts.set("r:1", { ...verdicts.get("r:1")!, status: "rejected" });
    await wait(60);
    expect(calls).toEqual(["verdict r:1 accepted"]);
  });

  it("hears snoozed records before the queue and restores the snooze on undo", async () => {
    const { session, calls } = await started([1, 2]);
    const at = "2026-01-02T03:04:05.000Z";
    session.startRound([snoozed(9, at)]);
    expect([session.current?.id, session.round?.total]).toEqual([9, 1]);
    session.judge("rejected");
    await wait();
    expect(session.round).toBeNull();
    expect(session.current?.id).toBe(1);
    session.undo();
    await wait();
    expect(session.current?.id).toBe(9);
    expect(calls).toEqual(["verdict r:9 rejected", `verdict r:9 snoozed ${at}`]);
  });

  it("keeps passes and undone queue releases when a round ends", async () => {
    const { session } = await started([1, 2, 3]);
    session.pass();
    session.judge("rejected");
    session.startRound([snoozed(9, "2026-01-02T03:04:05.000Z")]);
    session.undo();
    expect(session.upcoming.map((i) => i.id)).toEqual([2, 9]);
    session.endRound();
    expect(session.upcoming.map((i) => i.id)).toEqual([2, 3]);
    expect(session.passed.map((i) => i.id)).toEqual([1]);
    session.startRound([snoozed(9, "2026-01-02T03:04:05.000Z")]);
    await session.start(50);
    expect(session.passed.map((i) => i.id)).toEqual([1]);
  });

  it("forgets undo history made in the other mode", async () => {
    const { session, app, calls } = await started([1, 2]);
    session.judge("rejected");
    await wait();
    app.setSandbox(true);
    await session.start(50);
    session.undo();
    await wait();
    expect(session.flash).toBe("Nothing to undo.");
    expect(calls).toEqual(["verdict r:1 rejected"]);
  });
});
