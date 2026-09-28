import { queueItem } from "./helpers/catalog.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { type Api, createAppApi } from "../src/client/api.ts";
import { TriageSession } from "../src/client/triage/session.svelte.ts";
import type {
  ReleaseDetail,
  TwelvesItem,
  VerdictInput,
  TrackVerdictInput,
} from "../src/shared/api.ts";
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

/** A server stand-in that records the writes the session makes. */
function fakeServer(queue: number[], labelName: string | null = null) {
  const calls: string[] = [];
  /** Notes sent with verdicts, as "key note". */
  const notes: string[] = [];
  const verdicts = new Map<string, Verdict>();
  const state = { pushDelayMs: 0, enrichDelayMs: 0 };
  const http = {
    mode: "live",
    getQueue: async () => ({
      items: queue
        .map((id) => ({ ...queueItem(id), labelName }))
        .filter((i) => !verdicts.has(i.triageKey)),
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
      if (input.notes) notes.push(`${input.key} ${input.notes}`);
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
    postTrackVerdict: async (input: TrackVerdictInput) => {
      calls.push(`mark ${input.position} ${input.mark}`);
      if (input.mark === null) return null;
      return { ...input, notes: null, decidedAt: new Date().toISOString() };
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
    enrichRelease: async (id: number): Promise<ReleaseDetail> => {
      calls.push(`enrich ${id}`);
      await wait(state.enrichDelayMs);
      const snapshot = {
        lowestPrice: 9,
        numForSale: 2,
        currency: "EUR",
        communityHave: 10,
        communityWant: 40,
        enrichedAt: "2026-09-28T10:00:00.000Z",
      };
      return {
        release: { id, triageKey: `r:${id}`, snapshot } as ReleaseRecord,
        tracks: [],
        videos: [],
        verdict: null,
        trackVerdicts: [],
        siblings: [],
      };
    },
  } as unknown as Api;
  const app = createAppApi(http, (inner) => inner);
  return { app, http, calls, notes, verdicts, state };
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("session recovery", () => {
  it("ignores an older start that fails after a newer start succeeds", async () => {
    const { app, http } = fakeServer([1]);
    const pending = deferred<Awaited<ReturnType<Api["getQueue"]>>>();
    vi.spyOn(http, "getQueue").mockReturnValueOnce(pending.promise);
    const session = new TriageSession(app);
    const older = session.start(50);
    await session.start(50);
    pending.reject(new Error("old request failed"));
    await older;
    expect(session.status).toBe("ready");
    expect(session.current?.id).toBe(1);
    expect(session.error).toBeNull();
  });

  it("returns a rejected verdict to the queue without pushing it", async () => {
    const { session, http, calls } = await started([1, 2]);
    vi.spyOn(http, "postVerdict").mockRejectedValueOnce(new Error("disk full"));
    session.judge("accepted");
    await until(() => session.flash !== null);
    expect(session.current?.id).toBe(1);
    expect(session.history).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("keeps a failed undo available to retry and does not remove the want", async () => {
    const { session, http, calls } = await started([1, 2]);
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    vi.spyOn(http, "deleteVerdict").mockRejectedValueOnce(new Error("disk full"));
    session.undo();
    await until(() => session.flash?.startsWith("Undo failed") ?? false);
    expect(session.current?.id).toBe(2);
    expect(session.history).toHaveLength(1);
    expect(calls).not.toContain("remove 1");
    session.undo();
    await until(() => calls.includes("remove 1"));
    expect(session.current?.id).toBe(1);
  });

  it("does not let a failed old-mode write alter a restarted session", async () => {
    const { session, app, http } = await started([1, 2]);
    const pending = deferred<Verdict>();
    vi.spyOn(http, "postVerdict").mockReturnValueOnce(pending.promise);
    session.judge("accepted");
    await wait();
    app.setSandbox(true);
    await session.start(50);
    pending.reject(new Error("old mode failed"));
    await wait();
    expect(session.flash).toBeNull();
    expect(session.history).toEqual([]);
    expect(session.upcoming.map((item) => item.id)).toEqual([1, 2]);
  });

  it("loads new-mode details while old-mode details are still pending", async () => {
    const { app, http } = fakeServer([1]);
    const pending = deferred<ReleaseDetail>();
    const details = vi.spyOn(http, "getRelease").mockReturnValueOnce(pending.promise);
    const session = new TriageSession(app);
    await session.start(50);
    app.setSandbox(true);
    await session.start(50);
    await until(() => session.details.has(1));
    expect(details).toHaveBeenCalledTimes(2);
    pending.reject(new Error("old detail failed"));
    await wait();
    expect(session.detailErrors.size).toBe(0);
  });
});

async function withTracks() {
  const server = await started([1]);
  await until(() => server.session.details.has(1));
  const detail = server.session.details.get(1)!;
  server.session.details = new Map([
    [
      1,
      {
        ...detail,
        tracks: ["A1", "B1"].map((position, seq) => ({
          releaseId: 1,
          seq,
          position,
          title: position,
          artists: [],
          artistDisplay: "Artist",
          durationSeconds: 300,
          heardKey: position,
          heard: false,
          hasVideo: true,
          mark: null,
        })),
      },
    ],
  ]);
  return server;
}

describe("track mark recovery", () => {
  it("restores the saved mark when several rapid changes fail", async () => {
    const { session, http } = await withTracks();
    const writes = vi
      .spyOn(http, "postTrackVerdict")
      .mockRejectedValueOnce(new Error("first failed"))
      .mockRejectedValueOnce(new Error("second failed"));
    session.markTrack(1, "A1", "keep");
    session.markTrack(1, "A1", "candidate");
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(session.details.get(1)?.tracks[0]?.mark).toBeNull();
  });

  it("recovers one track without reverting a newer mark on another", async () => {
    const { session, http, calls } = await withTracks();
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("first failed"));
    session.markTrack(1, "A1", "keep");
    session.markTrack(1, "B1", "candidate");
    await until(() => calls.includes("mark B1 candidate"));
    expect(session.details.get(1)?.tracks.map((track) => track.mark)).toEqual([null, "candidate"]);
  });

  it("restores the last successful mark after the next change fails", async () => {
    const { session, http, calls } = await withTracks();
    session.markTrack(1, "A1", "keep");
    await until(() => calls.includes("mark A1 keep"));
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("second failed"));
    session.markTrack(1, "A1", "candidate");
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(session.details.get(1)?.tracks[0]?.mark).toBe("keep");
  });
});

it("cancels a pending grace period when the session is destroyed", async () => {
  const { session, calls } = await started([1, 2], 40);
  session.judge("accepted");
  await wait(5);
  session.showFlash("Closing");
  session.destroy();
  await wait(60);
  expect(calls).toEqual(["verdict r:1 accepted"]);
});

describe("enrich ahead", () => {
  it("enriches the records coming up and shows their market data", async () => {
    const server = fakeServer([1, 2, 3, 4]);
    const session = new TriageSession(server.app, { pushGraceMs: 0 });
    const enriched = () => server.calls.filter((call) => call.startsWith("enrich"));
    await session.start(50, { enrichAhead: 2 });
    await until(() => enriched().length === 3);
    expect(enriched()).toEqual(["enrich 1", "enrich 2", "enrich 3"]);
    await until(() => session.upcoming[2]?.communityWant === 40);
    expect(session.current).toMatchObject({ id: 1, lowestPrice: 9, communityWant: 40 });
    session.judge("rejected");
    await until(() => server.calls.includes("enrich 4"));
    expect(enriched().filter((call) => call === "enrich 2")).toHaveLength(1);
    session.destroy();
  });

  it("keeps the market data of a record judged before it arrived", async () => {
    const server = fakeServer([1, 2, 3]);
    server.state.enrichDelayMs = 20;
    const session = new TriageSession(server.app, { pushGraceMs: 0 });
    await session.start(50, { enrichAhead: 1 });
    session.judge("rejected");
    await until(() => server.calls.includes("enrich 2"));
    session.undo();
    expect(session.current).toMatchObject({ id: 1, communityWant: 40 });
    session.destroy();
  });

  it("enriches nothing when enrich ahead is off", async () => {
    const { session, calls } = await started([1, 2]);
    await wait(10);
    expect(calls.some((call) => call.startsWith("enrich"))).toBe(false);
    session.destroy();
  });
});

describe("notes in Triage", () => {
  it("keeps a note with its record until the verdict saves it", async () => {
    const { session, calls, notes } = await started([1, 2]);
    session.setNote(session.current!, "  the Kool FM tune  ");
    session.pass();
    session.judge("rejected");
    await until(() => calls.includes("verdict r:2 rejected"));
    session.undo();
    session.undo();
    expect(session.noteFor(session.current!)).toBe("the Kool FM tune");
    session.judge("accepted");
    await until(() => notes.includes("r:1 the Kool FM tune"));
    session.destroy();
  });

  it("starts from a snoozed record's note, and an empty note removes it", async () => {
    const { session, calls, notes } = await started([1]);
    session.startRound([snoozed(5, "2026-01-01T00:00:00.000Z")]);
    expect(session.noteFor(session.current!)).toBe("check the flip");
    session.setNote(session.current!, " ");
    session.judge("rejected");
    await until(() => calls.includes("verdict r:5 rejected"));
    expect(notes).toEqual([]);
    session.destroy();
  });
});

describe("hiding a label", () => {
  async function withLabels(fail = false) {
    const server = fakeServer([1, 2], "Moving Shadow");
    const changes: string[] = [];
    const setLabelHidden = async (label: string, hidden: boolean) => {
      if (fail) throw new Error("disk full");
      changes.push(`${hidden ? "hide" : "show"} ${label}`);
    };
    const session = new TriageSession(server.app, { pushGraceMs: 0, setLabelHidden });
    await session.start(50);
    return { session, changes, calls: server.calls };
  }

  it("hides the label on screen, and Z lets it back before older verdicts", async () => {
    const { session, changes, calls } = await withLabels();
    session.judge("rejected");
    await session.hideLabel();
    expect(changes).toEqual(["hide Moving Shadow"]);
    expect(session.slip).toMatchObject({ kind: "label", label: "Moving Shadow" });
    session.undo();
    await until(() => changes.length === 2);
    expect(changes).toEqual(["hide Moving Shadow", "show Moving Shadow"]);
    expect(session.slip).toMatchObject({ kind: "undo", undone: "label" });
    session.undo();
    await until(() => calls.includes("forget r:1"));
    session.destroy();
  });

  it("keeps the history as it was when saving the filters fails", async () => {
    const { session } = await withLabels(true);
    await session.hideLabel();
    expect(session.history).toEqual([]);
    expect(session.flash).toContain("disk full");
    session.destroy();
  });
});
