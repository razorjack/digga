import { queueItem } from "./helpers/catalog.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { type Api, type AppApi, createAppApi } from "../src/client/api.ts";
import { TriageSession } from "../src/client/triage/session.svelte.ts";
import { stats } from "../src/client/stores.svelte.ts";
import type {
  QueueQuery,
  ReleaseDetail,
  Stats,
  TwelvesItem,
  VerdictInput,
  TrackVerdictInput,
} from "../src/shared/api.ts";
import { DEFAULT_CONFIG } from "../src/shared/config.ts";
import type { QueueScope } from "../src/shared/scope.ts";
import {
  type ReleaseRecord,
  type Verdict,
  VERDICT_STATUSES,
  type VerdictStatus,
} from "../src/shared/types.ts";

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
  const queries: QueueQuery[] = [];
  const state = { pushDelayMs: 0, enrichDelayMs: 0 };
  const detail = (id: number): ReleaseDetail => ({
    release: { id, triageKey: `r:${id}` } as ReleaseRecord,
    tracks: [],
    videos: [],
    verdict: verdicts.get(`r:${id}`) ?? null,
    trackVerdicts: [],
    siblings: [],
  });
  const http = {
    mode: "live",
    getQueue: async (query: QueueQuery = {}) => {
      queries.push(query);
      return {
        items: queue
          .map((id) => ({ ...queueItem(id), labelName }))
          .filter((i) => !verdicts.has(i.triageKey)),
        remaining: 0,
        strategy: "label_sweep",
        seed: null,
        filters: DEFAULT_CONFIG.filters,
      };
    },
    getRelease: async (id: number): Promise<ReleaseDetail> => detail(id),
    attachVideo: async (id: number): Promise<ReleaseDetail> => {
      calls.push(`attach ${id}`);
      // As the server does: a new video sends a record marked no audio back to the queue.
      if (verdicts.get(`r:${id}`)?.status === "no_audio") verdicts.delete(`r:${id}`);
      return detail(id);
    },
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
        dugAt: input.decidedAt ?? new Date().toISOString(),
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
  return { app, http, calls, notes, verdicts, queries, state };
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
    dugAt: decidedAt,
  },
  release: queueItem(id),
  onWantlist: false,
});

describe("triage session", () => {
  it("asks again at the end of the queue, for records a running load has added", async () => {
    const queue = [1];
    const { session } = await started(queue);
    session.judge("rejected");
    await until(() => session.finished);

    await session.lookAgain();
    expect(session.finished).toBe(true);
    queue.push(2, 3);
    await session.lookAgain();

    expect(session.finished).toBe(false);
    expect(session.current?.id).toBe(2);
  });

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

  it("puts a grail on the wantlist like a want, and Z takes it off again", async () => {
    const { session, calls } = await started([1, 2]);
    session.judge("candidate");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    session.undo();
    await until(() => calls.includes("remove 1"));
    await wait();
    expect(calls.toSorted()).toEqual(["forget r:1", "put 1", "remove 1", "verdict r:1 candidate"]);
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

  it("keeps the slip busy until the server has answered the verdict, and then the undo", async () => {
    const { session, http, calls } = await started([1, 2], 1000);
    const answer = Promise.withResolvers<void>();
    const postVerdict = http.postVerdict.bind(http);
    vi.spyOn(http, "postVerdict").mockImplementationOnce(async (input) => {
      await answer.promise;
      return postVerdict(input);
    });
    session.judge("accepted");
    expect(session.slipBusy).toBe(true);
    answer.resolve();
    await until(() => !session.slipBusy);

    session.undo();
    expect(session.slipBusy).toBe(true);
    await until(() => !session.slipBusy);
    expect(calls).toEqual(["verdict r:1 accepted", "forget r:1"]);
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

describe("reading the queue again", () => {
  /** D on the record on screen, saved, and then a link pasted on it in Twelves. */
  async function sentBack(session: TriageSession, app: AppApi): Promise<number> {
    const id = session.current!.id;
    session.judge("no_audio");
    await until(() => !session.slipBusy);
    await app.attachVideo(id, "https://youtu.be/relicstatic");
    return id;
  }

  const ids = (session: TriageSession) => session.upcoming.map((item) => item.id);

  it("puts a record sent back from Twelves after the one on screen, in the queue's order", async () => {
    const { session, app } = await started([1, 2, 3, 4]);
    await sentBack(session, app);
    expect(ids(session)).toEqual([2, 3, 4]);

    await session.readAgain();
    expect(ids(session)).toEqual([2, 1, 3, 4]);
    expect(session.next?.id).toBe(1);
  });

  it("offers it at the end of the queue too, once the verdict has gone from the server", async () => {
    const { session, app } = await started([1]);
    await sentBack(session, app);
    expect(session.finished).toBe(true);

    await session.lookAgain();
    expect(session.finished).toBe(false);
    expect(session.current?.id).toBe(1);
  });

  it("keeps the list as it is when the queue's order has not changed", async () => {
    const { session, queries } = await started([1, 2, 3]);
    const upcoming = session.upcoming;
    await session.readAgain();
    expect(queries).toHaveLength(2);
    expect(session.upcoming).toBe(upcoming);
  });

  it("leaves passes out until the end of the queue, and keeps the scope", async () => {
    const { session, queries } = await started([1, 2, 3]);
    const label: QueueScope = { kind: "label", id: 88, name: "Moving Shadow" };
    await session.setScope(label);
    session.pass();
    await session.readAgain();
    expect(ids(session)).toEqual([2, 3]);
    expect(session.passed.map((item) => item.id)).toEqual([1]);
    expect(queries.at(-1)?.scope).toEqual(label);
    session.destroy();
  });

  it("reads nothing during a round of snoozed records", async () => {
    const { session, queries } = await started([1, 2]);
    session.startRound([snoozed(9, "2026-01-02T03:04:05.000Z")]);
    await session.readAgain();
    expect(queries).toHaveLength(1);
    expect(ids(session)).toEqual([9]);
  });

  it("keeps out a record whose verdict the server has not answered", async () => {
    const { session, http } = await started([1, 2, 3]);
    const answer = Promise.withResolvers<void>();
    const postVerdict = http.postVerdict.bind(http);
    vi.spyOn(http, "postVerdict").mockImplementationOnce(async (input) => {
      await answer.promise;
      return postVerdict(input);
    });
    session.judge("rejected");
    await session.readAgain();
    expect(ids(session)).toEqual([2, 3]);
    answer.resolve();
  });

  it("keeps out a record judged while the queue was being read, though its write answered first", async () => {
    const { session, http } = await started([1, 2, 3]);
    const answer = Promise.withResolvers<void>();
    const getQueue = http.getQueue.bind(http);
    vi.spyOn(http, "getQueue").mockImplementationOnce(async (query) => {
      // The server read the queue before the verdict arrived.
      const response = await getQueue(query);
      await answer.promise;
      return response;
    });
    const reading = session.readAgain();
    session.judge("rejected");
    await until(() => !session.slipBusy);
    answer.resolve();
    await reading;
    expect(ids(session)).toEqual([2, 3]);
  });

  it("waits for a refill in flight, and a refill asked for meanwhile waits for it", async () => {
    const { session, http, queries } = await started([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const answer = Promise.withResolvers<void>();
    const getQueue = http.getQueue.bind(http);
    vi.spyOn(http, "getQueue").mockImplementationOnce(async (query) => {
      await answer.promise;
      return getQueue(query);
    });
    // Below eight buffered records, a verdict starts a refill.
    session.judge("rejected");
    session.judge("rejected");
    const reading = session.readAgain();
    session.judge("rejected");
    answer.resolve();
    await reading;
    expect(queries).toHaveLength(3);
    expect(ids(session)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("drops a restarted session's read", async () => {
    const { session, http } = await started([1, 2, 3]);
    const answer = Promise.withResolvers<void>();
    const getQueue = http.getQueue.bind(http);
    const asked = vi.spyOn(http, "getQueue").mockImplementationOnce(async (query) => {
      await answer.promise;
      return { ...(await getQueue(query)), items: [] };
    });
    const reading = session.readAgain();
    expect(asked).toHaveBeenCalledOnce();
    await session.start(50);
    answer.resolve();
    await reading;
    expect(ids(session)).toEqual([1, 2, 3]);
  });

  it("forgets the record's verdict in the undo history, and loads its details again", async () => {
    const { session, app, http, calls } = await started([1, 2, 3]);
    await until(() => session.details.has(1));
    const details = vi.spyOn(http, "getRelease");
    await sentBack(session, app);
    await session.readAgain();
    await until(() => details.mock.calls.flat().includes(1));

    session.judge("rejected");
    session.judge("snoozed");
    await until(() => !session.slipBusy);
    session.undo();
    session.undo();
    await until(() => !session.slipBusy);
    expect(session.current?.id).toBe(2);
    session.undo();
    expect(session.flash).toBe("Nothing to undo.");
    expect(calls.filter((call) => call.startsWith("forget"))).toEqual(["forget r:1", "forget r:2"]);
  });

  it("undoes a later verdict on a snoozed record sent back without restoring the snooze", async () => {
    const queue = [1, 2];
    const { session, app, calls } = await started(queue);
    session.startRound([snoozed(9, "2026-01-02T03:04:05.000Z")]);
    await sentBack(session, app);
    // Its snooze is gone with the no-audio verdict, so the queue has the record.
    queue.unshift(9);
    await session.readAgain();
    expect(ids(session)).toEqual([1, 9, 2]);

    session.pass();
    session.judge("rejected");
    await until(() => !session.slipBusy);
    session.undo();
    await until(() => !session.slipBusy);
    expect(calls.at(-1)).toBe("forget r:9");
  });

  it("offers a record sent back in the sandbox, whose queue leaves out the sandbox's verdicts", async () => {
    const { http } = fakeServer([1, 2, 3]);
    const app = createAppApi(http);
    const session = new TriageSession(app, { pushGraceMs: 0 });
    await session.start(50);
    expect(app.mode).toBe("sandbox");
    await sentBack(session, app);
    expect(ids(session)).toEqual([2, 3]);

    await session.readAgain();
    expect(ids(session)).toEqual([2, 1, 3]);
  });

  it("keeps a sandbox verdict out of the queue", async () => {
    const { http } = fakeServer([1, 2, 3]);
    const session = new TriageSession(createAppApi(http), { pushGraceMs: 0 });
    await session.start(50);
    session.judge("rejected");
    await until(() => !session.slipBusy);
    await session.readAgain();
    expect(ids(session)).toEqual([2, 3]);
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

const MOMENT = { videoId: "aaaaaaaaaa1", atSeconds: 61.5 };

describe("track mark recovery", () => {
  it("restores the saved mark when several rapid changes fail", async () => {
    const { session, http } = await withTracks();
    const writes = vi
      .spyOn(http, "postTrackVerdict")
      .mockRejectedValueOnce(new Error("first failed"))
      .mockRejectedValueOnce(new Error("second failed"));
    session.markTrack(1, "A1", "keep", MOMENT);
    session.markTrack(1, "A1", "candidate", MOMENT);
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(session.details.get(1)?.tracks[0]?.mark).toBeNull();
  });

  it("recovers one track without reverting a newer mark on another", async () => {
    const { session, http, calls } = await withTracks();
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("first failed"));
    session.markTrack(1, "A1", "keep", MOMENT);
    session.markTrack(1, "B1", "candidate", MOMENT);
    await until(() => calls.includes("mark B1 candidate"));
    expect(session.details.get(1)?.tracks.map((track) => track.mark)).toEqual([null, "candidate"]);
  });

  it("restores the last successful mark after the next change fails", async () => {
    const { session, http, calls } = await withTracks();
    session.markTrack(1, "A1", "keep", MOMENT);
    await until(() => calls.includes("mark A1 keep"));
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("second failed"));
    session.markTrack(1, "A1", "candidate", MOMENT);
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(session.details.get(1)?.tracks[0]?.mark).toBe("keep");
  });

  it("saves the video and second playing with the mark", async () => {
    const { session, http, calls } = await withTracks();
    const writes = vi.spyOn(http, "postTrackVerdict");
    session.markTrack(1, "B1", "candidate", MOMENT);
    await until(() => calls.includes("mark B1 candidate"));
    expect(writes).toHaveBeenCalledWith({
      releaseId: 1,
      position: "B1",
      mark: "candidate",
      videoId: "aaaaaaaaaa1",
      atSeconds: 61.5,
    });
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

describe("pricing with P", () => {
  it("asks Discogs only when P is pressed, for the record on screen", async () => {
    const { session, calls } = await started([1, 2, 3]);
    session.judge("rejected");
    await session.price();
    expect(calls.filter((call) => call.startsWith("enrich"))).toEqual(["enrich 2"]);
    expect(session.current).toMatchObject({ id: 2, lowestPrice: 9, communityWant: 40 });
    expect(session.pricing.size).toBe(0);
    session.destroy();
  });

  it("ignores P while the answer is on its way", async () => {
    const server = fakeServer([1, 2]);
    server.state.enrichDelayMs = 20;
    const session = new TriageSession(server.app, { pushGraceMs: 0 });
    await session.start(50);
    const first = session.price();
    expect(session.pricing.has(1)).toBe(true);
    await session.price();
    await first;
    expect(server.calls.filter((call) => call.startsWith("enrich"))).toEqual(["enrich 1"]);
    await session.price();
    expect(server.calls.filter((call) => call.startsWith("enrich"))).toHaveLength(2);
    session.destroy();
  });

  it("keeps the market data of a record judged before it arrived", async () => {
    const server = fakeServer([1, 2, 3]);
    server.state.enrichDelayMs = 20;
    const session = new TriageSession(server.app, { pushGraceMs: 0 });
    await session.start(50);
    const priced = session.price();
    session.judge("rejected");
    await priced;
    session.undo();
    expect(session.current).toMatchObject({ id: 1, communityWant: 40 });
    session.destroy();
  });

  it("says so when Discogs does not answer", async () => {
    const { session, http } = await started([1, 2]);
    http.enrichRelease = () => Promise.reject(new Error("Discogs did not return the release"));
    await session.price();
    expect(session.flash).toBe("The price did not load: Discogs did not return the release");
    expect(session.current?.enrichedAt).toBeNull();
    expect(session.pricing.size).toBe(0);
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

describe("digging one label or artist", () => {
  const label: QueueScope = { kind: "label", id: 88, name: "Moving Shadow" };

  function statsWith(counts: { remaining: number; scopeRemaining: number | null }): Stats {
    const verdicts = Object.fromEntries(VERDICT_STATUSES.map((status) => [status, 0]));
    return {
      dug: 0,
      universe: { releases: 10, keys: 10, filteredKeys: 10 },
      verdicts: verdicts as Record<VerdictStatus, number>,
      rate: { verdictsPerHour: null, sessions: 0, etaHours: null },
      dump: { date: null, loadedAt: null, lastLoad: null },
      heardTracks: 0,
      ...counts,
    };
  }

  it("asks for the scope until Esc lets everything back, and passes start over", async () => {
    const { session, queries } = await started([1, 2, 3]);
    session.pass();
    await session.setScope(label);
    expect([session.scope, stats.scope, queries.at(-1)?.scope]).toEqual([label, label, label]);
    // The pass belonged to the whole queue; the record comes back in its place.
    expect(session.passed).toEqual([]);
    expect(session.upcoming.map((item) => item.id)).toEqual([1, 2, 3]);
    // A settings save restarts the queue in the same scope.
    await session.start(50);
    expect(queries.at(-1)?.scope).toEqual(label);
    await session.setScope(null);
    expect([session.scope, stats.scope, queries.at(-1)?.scope]).toEqual([null, null, undefined]);
    session.destroy();
  });

  it("counts a verdict and its undo in the records left in the scope", async () => {
    const { session } = await started([1, 2]);
    await session.setScope(label);
    stats.value = statsWith({ remaining: 10, scopeRemaining: 2 });
    session.judge("rejected");
    expect(stats.value).toMatchObject({ remaining: 9, scopeRemaining: 1 });
    session.undo();
    expect(stats.value).toMatchObject({ remaining: 10, scopeRemaining: 2 });
    // The count of another scope is unknown until the stats come back.
    await session.setScope({ kind: "artist", id: 12, name: "Optical" });
    expect(stats.value?.scopeRemaining).toBeNull();
    session.destroy();
    stats.value = null;
  });
});
