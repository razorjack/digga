import { queueItem } from "./helpers/catalog.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { type Api, ApiRequestError } from "../src/client/api.ts";
import { TriageSession } from "../src/client/triage/session.svelte.ts";
import { stats } from "../src/client/stores.svelte.ts";
import type {
  QueueQuery,
  ReleaseDetail,
  Stats,
  VerdictInput,
  TrackVerdictInput,
} from "../src/shared/api.ts";
import type { ReplayItem } from "../src/shared/replay.ts";
import { DEFAULT_CONFIG, type HiddenLabel } from "../src/shared/config.ts";
import type { QueueScope } from "../src/shared/scope.ts";
import {
  type ReleaseRecord,
  type Verdict,
  VERDICT_STATUSES,
  type VerdictStatus,
  type VideoRecord,
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
function fakeServer(queue: number[], label: HiddenLabel | null = null) {
  const calls: string[] = [];
  /** Release notes saved, as "release id note". */
  const notes: string[] = [];
  /** Notes the server has saved for releases, by release id. */
  const releaseNotes = new Map<number, string>();
  const verdicts = new Map<string, Verdict>();
  const queries: QueueQuery[] = [];
  const state = { pushDelayMs: 0, enrichDelayMs: 0 };
  const detail = (id: number): ReleaseDetail => ({
    release: { id, triageKey: `r:${id}` } as ReleaseRecord,
    tracks: [],
    videos: [],
    verdict: verdicts.get(`r:${id}`) ?? null,
    note: releaseNotes.get(id) ?? null,
    pressingNotes: [],
    trackVerdicts: [],
    siblings: [],
    listings: [],
  });
  const http = {
    getQueue: async (query: QueueQuery = {}) => {
      queries.push(query);
      return {
        items: queue
          .map((id) => ({
            ...queueItem(id),
            labelId: label?.id ?? null,
            labelName: label?.name ?? null,
          }))
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
    putReleaseNote: async (id: number, note: string | null) => {
      notes.push(`${id} ${note}`);
      return { notes: note };
    },
    postVerdict: async (input: VerdictInput) => {
      calls.push(
        `verdict ${input.key} ${input.status}${input.decidedAt ? ` ${input.decidedAt}` : ""}`,
      );
      const v: Verdict = {
        key: input.key,
        status: input.status,
        source: input.source ?? "triage",
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
        videos: [{ videoId: `fresh-${id}` } as VideoRecord],
        verdict: null,
        pressingNotes: [],
        trackVerdicts: [],
        siblings: [],
        listings: [],
      };
    },
  } as unknown as Api;
  const app: Api = http;
  return { app, http, calls, notes, releaseNotes, verdicts, queries, state };
}

async function started(queue: number[]) {
  const server = fakeServer(queue);
  const session = new TriageSession(server.app, { pushRetryDelaysMs: [5, 5, 5] });
  await session.start(50);
  return { ...server, session };
}

/** A snoozed record as Twelves hands it to Triage. */
const snoozed = (
  id: number,
  decidedAt: string,
): ReplayItem & { verdict: Verdict; onWantlist: boolean } => ({
  verdict: { key: `r:${id}`, status: "snoozed", source: "triage", releaseId: id, decidedAt },
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

  it("pushes a want as soon as its verdict is saved", async () => {
    const { session, calls } = await started([1, 2]);
    session.judge("accepted");
    await until(() => calls.includes("put 1"));
    expect(calls).toEqual(["verdict r:1 accepted", "put 1"]);
  });

  it("sends nothing to Discogs when the want is undone before its verdict is saved", async () => {
    const { session, calls } = await started([1, 2]);
    session.judge("accepted");
    session.undo();
    await until(() => calls.includes("forget r:1"));
    await wait(20);
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

  it("tries a push that failed on the way again, and lands it", async () => {
    const { session, http, calls } = await started([1, 2]);
    vi.spyOn(http, "pushToWantlist").mockRejectedValueOnce(new Error("Failed to fetch"));
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    expect(calls.filter((call) => call.startsWith("put"))).toEqual(["put 1"]);
    expect(session.flash).toBeNull();
  });

  it("gives up after the last retry, naming the record", async () => {
    const { session, http } = await started([1, 2]);
    const pushes = vi
      .spyOn(http, "pushToWantlist")
      .mockRejectedValue(new ApiRequestError(502, "Discogs answered 503"));
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "failed");
    expect(pushes).toHaveBeenCalledTimes(4);
    expect(session.flash).toBe(
      `${queueItem(1).artistDisplay} – ${queueItem(1).title} is not on the Discogs wantlist: Discogs answered 503. A in Twelves tries again.`,
    );
  });

  it("ends at once a push Discogs refused for its token", async () => {
    const { session, http } = await started([1, 2]);
    const refusal =
      "Discogs answered 403: check the Discogs token in Settings and that it belongs to your Discogs username";
    const pushes = vi
      .spyOn(http, "pushToWantlist")
      .mockRejectedValue(new ApiRequestError(403, refusal));
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "failed");
    await wait(20);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(session.flash).toBe(
      `${queueItem(1).artistDisplay} – ${queueItem(1).title} is not on the Discogs wantlist: ${refusal}. A in Twelves tries again.`,
    );
  });

  it("does not try again a push the server refused", async () => {
    const { session, http } = await started([1, 2]);
    const pushes = vi
      .spyOn(http, "pushToWantlist")
      .mockRejectedValue(new ApiRequestError(400, "Set your Discogs username in Settings first"));
    session.judge("candidate");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "failed");
    await wait(20);
    expect(pushes).toHaveBeenCalledTimes(1);
  });

  it("keeps a restored random seed in later queue reads and checkpoints", async () => {
    const server = fakeServer([1, 2]);
    const getQueue = server.http.getQueue.bind(server.http);
    vi.spyOn(server.http, "getQueue").mockImplementation(async (query) => ({
      ...(await getQueue(query)),
      seed: query?.seed ?? 77,
    }));
    const session = new TriageSession(server.app);
    await session.start(50, { seed: 123 });
    expect(server.queries[0]?.seed).toBe(123);
    expect(session.checkpoint(null).seed).toBe(123);
    await session.readAgain();
    expect(server.queries.at(-1)?.seed).toBe(123);
    session.destroy();
  });

  it("restores a browser-history verdict when undoing a fresh judgment", async () => {
    const server = fakeServer([1, 2]);
    const session = new TriageSession(server.app);
    await session.start(50);
    await until(() => session.currentDetail !== null);
    const previous = await server.http.postVerdict({
      key: "r:1",
      releaseId: 1,
      status: "seen",
      source: "seed:history",
    });
    const detail = session.details.get(1)!;
    session.details = new Map(session.details).set(1, { ...detail, verdict: previous });
    session.judge("rejected");
    await until(() => server.verdicts.get("r:1")?.status === "rejected");
    session.undo();
    await until(() => server.verdicts.get("r:1")?.status === "seen");
    expect(server.verdicts.get("r:1")).toEqual(previous);
    session.destroy();
  });

  it("stops trying when the want is undone while it waits to try again", async () => {
    const server = fakeServer([1, 2]);
    const session = new TriageSession(server.app, { pushRetryDelaysMs: [30] });
    await session.start(50);
    const pushes = vi
      .spyOn(server.http, "pushToWantlist")
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    session.judge("accepted");
    await until(() => pushes.mock.calls.length === 1);
    session.undo();
    await until(() => server.calls.includes("forget r:1"));
    await wait(60);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(server.calls.filter((call) => call.startsWith("remove"))).toEqual([]);
  });

  it("does not push a want re-judged elsewhere while it waited for a slow push", async () => {
    const { session, calls, verdicts, state } = await started([1, 2, 3]);
    state.pushDelayMs = 40;
    session.judge("accepted");
    await until(() => calls.includes("put 1"));
    session.judge("accepted");
    await until(() => verdicts.has("r:2"));
    verdicts.set("r:2", { ...verdicts.get("r:2")!, status: "rejected" });
    await until(() => session.slip?.kind === "verdict" && session.slip.push !== "pending");
    expect(calls.filter((call) => call.startsWith("put"))).toEqual(["put 1"]);
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

  it("replays saved wants without writes and protects pre-existing membership on undo", async () => {
    const { session, calls, verdicts } = await started([1, 2]);
    const item = snoozed(9, "2026-01-02T03:04:05.000Z");
    item.verdict.status = "accepted";
    item.onWantlist = true;
    verdicts.set(item.verdict.key, item.verdict);
    session.startRound([item]);
    session.pass();
    expect(session.current?.id).toBe(1);
    expect(calls).toEqual([]);
    session.startRound([item]);
    session.judge("candidate");
    await until(() => verdicts.get(item.verdict.key)?.status === "candidate");
    session.undo();
    await until(() => verdicts.get(item.verdict.key)?.status === "accepted");
    expect(calls.filter((call) => call.startsWith("put") || call.startsWith("remove"))).toEqual([]);
    session.destroy();
  });

  it("restores a pre-existing want after undoing an explicit replay rejection", async () => {
    const { session, calls, verdicts } = await started([1, 2]);
    const item = snoozed(9, "2026-01-02T03:04:05.000Z");
    item.verdict.status = "accepted";
    item.onWantlist = true;
    verdicts.set(item.verdict.key, item.verdict);
    session.startRound([item]);
    session.judge("rejected");
    await until(() => calls.includes("remove 9"));
    session.undo();
    await until(() => calls.includes("put 9"));
    expect(verdicts.get(item.verdict.key)?.status).toBe("accepted");
    session.destroy();
  });

  it("replays an unjudged marked track, and judges a record only Discogs holds like any other", async () => {
    const { session, calls } = await started([1, 2]);
    session.startRound([{ release: queueItem(9), verdict: null }]);
    session.endRound();
    expect(session.current?.id).toBe(1);
    session.startRound([{ release: queueItem(10), verdict: null, onWantlist: true }]);
    session.judge("accepted");
    await until(() => !session.slipBusy);
    // Already on the wantlist, so the want sends nothing to Discogs.
    expect(calls).toEqual(["verdict r:10 accepted"]);
    session.destroy();
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
    const { session, http, calls } = await started([1, 2]);
    const answer = Promise.withResolvers<void>();
    const postVerdict = http.postVerdict.bind(http);
    vi.spyOn(http, "postVerdict").mockImplementationOnce(async (input) => {
      await answer.promise;
      return postVerdict(input);
    });
    session.judge("rejected");
    expect(session.slipBusy).toBe(true);
    answer.resolve();
    await until(() => !session.slipBusy);

    session.undo();
    expect(session.slipBusy).toBe(true);
    await until(() => !session.slipBusy);
    expect(calls).toEqual(["verdict r:1 rejected", "forget r:1"]);
  });

  it("undoes a verdict under the key the server saved it, after a load moved its release", async () => {
    const { session, http, calls } = await started([1, 2]);
    const postVerdict = http.postVerdict.bind(http);
    // The server files the verdict under the record release 1 is on since a dump load.
    vi.spyOn(http, "postVerdict").mockImplementationOnce(async (input) => ({
      ...(await postVerdict(input)),
      key: "m:900",
    }));
    session.judge("rejected");
    await until(() => !session.slipBusy);

    session.undo();
    await until(() => !session.slipBusy);
    expect(calls).toEqual(["verdict r:1 rejected", "forget m:900"]);
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

  it("drops an undo the server refuses because another tab decided the record again", async () => {
    const { session, http, calls } = await started([1, 2]);
    session.judge("accepted");
    await until(() => session.slip?.kind === "verdict" && session.slip.push === "done");
    const forget = vi
      .spyOn(http, "deleteVerdict")
      .mockRejectedValueOnce(
        new ApiRequestError(409, "The record's verdict changed since this page read it"),
      );
    session.undo();
    await until(() => session.flash?.startsWith("Undo failed") ?? false);
    expect(forget).toHaveBeenCalledWith("r:1", expect.objectContaining({ status: "accepted" }));
    expect(session.current?.id).toBe(2);
    expect(session.history).toEqual([]);
    expect(calls).not.toContain("remove 1");
  });

  it("does not let a write that fails after destroy() change the session", async () => {
    const { session, http } = await started([1, 2]);
    const pending = deferred<Verdict>();
    vi.spyOn(http, "postVerdict").mockReturnValueOnce(pending.promise);
    session.judge("accepted");
    await wait();
    session.destroy();
    pending.reject(new Error("too late"));
    await wait();
    expect(session.flash).toBeNull();
    expect(session.history).toHaveLength(1);
    expect(session.upcoming.map((item) => item.id)).toEqual([2]);
  });

  it("drops a detail that fails after destroy()", async () => {
    const { app, http } = fakeServer([1]);
    const pending = deferred<ReleaseDetail>();
    vi.spyOn(http, "getRelease").mockReturnValueOnce(pending.promise);
    const session = new TriageSession(app);
    await session.start(50);
    session.destroy();
    pending.reject(new Error("too late"));
    await wait();
    expect(session.detailErrors.size).toBe(0);
  });
});

describe("reading the queue again", () => {
  /** D on the record on screen, saved, and then a link pasted on it in Twelves. */
  async function sentBack(session: TriageSession, app: Api): Promise<number> {
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
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "keep", MOMENT);
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "candidate", MOMENT);
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(session.details.get(1)?.tracks[0]?.mark).toBeNull();
  });

  it("recovers one track without reverting a newer mark on another", async () => {
    const { session, http, calls } = await withTracks();
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("first failed"));
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "keep", MOMENT);
    session.markTrack(1, { position: "B1", heardKey: "B1" }, "candidate", MOMENT);
    await until(() => calls.includes("mark B1 candidate"));
    expect(session.details.get(1)?.tracks.map((track) => track.mark)).toEqual([null, "candidate"]);
  });

  it("restores the last successful mark after the next change fails", async () => {
    const { session, http, calls } = await withTracks();
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "keep", MOMENT);
    await until(() => calls.includes("mark A1 keep"));
    vi.spyOn(http, "postTrackVerdict").mockRejectedValueOnce(new Error("second failed"));
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "candidate", MOMENT);
    await until(() => session.flash?.includes("second failed") ?? false);
    expect(session.details.get(1)?.tracks[0]?.mark).toBe("keep");
  });

  it("saves the video and second playing with the mark", async () => {
    const { session, http, calls } = await withTracks();
    const writes = vi.spyOn(http, "postTrackVerdict");
    session.markTrack(1, { position: "B1", heardKey: "B1" }, "candidate", MOMENT);
    await until(() => calls.includes("mark B1 candidate"));
    expect(writes).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: 1,
        position: "B1",
        mark: "candidate",
        videoId: "aaaaaaaaaa1",
        atSeconds: 61.5,
      }),
    );
  });
});

it("stops trying a failed push again once the session is destroyed", async () => {
  const server = fakeServer([1, 2]);
  const session = new TriageSession(server.app, { pushRetryDelaysMs: [30] });
  await session.start(50);
  const pushes = vi
    .spyOn(server.http, "pushToWantlist")
    .mockRejectedValueOnce(new Error("Failed to fetch"));
  session.judge("accepted");
  await until(() => pushes.mock.calls.length === 1);
  session.destroy();
  await wait(60);
  expect(pushes).toHaveBeenCalledTimes(1);
});

it("pushes nothing once the session is destroyed before the verdict is saved", async () => {
  const { session, calls } = await started([1, 2]);
  session.judge("accepted");
  session.showFlash("Closing");
  session.destroy();
  await wait(20);
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

  it("shows the fresh videos of the record on screen and keeps its track marks", async () => {
    const { session } = await withTracks();
    session.markTrack(1, { position: "A1", heardKey: "A1" }, "keep", MOMENT);
    await session.price();
    expect(session.currentDetail?.videos.map((video) => video.videoId)).toEqual(["fresh-1"]);
    expect(session.currentDetail?.tracks[0]?.mark).not.toBeNull();
    session.destroy();
  });

  it("ignores P while the answer is on its way", async () => {
    const server = fakeServer([1, 2]);
    server.state.enrichDelayMs = 20;
    const session = new TriageSession(server.app);
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
    const session = new TriageSession(server.app);
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
  it("saves a note on the release, apart from the verdicts made after it", async () => {
    const { session, calls, notes } = await started([1, 2]);
    session.setNote(session.current!, "  the Kool FM tune  ");
    session.pass();
    session.judge("rejected");
    await until(() => calls.includes("verdict r:2 rejected"));
    session.undo();
    session.undo();
    expect(session.noteFor(session.current!)).toBe("the Kool FM tune");
    session.judge("accepted");
    await until(() => calls.includes("verdict r:1 accepted"));
    expect(notes).toEqual(["1 the Kool FM tune"]);
    session.destroy();
  });

  it("reports a failed note save and leaves the previous note visible", async () => {
    const server = fakeServer([1]);
    server.http.putReleaseNote = async () => {
      throw new Error("disk full");
    };
    const session = new TriageSession(server.app);
    await session.start(50);
    session.setNote(session.current!, "new note");
    await until(() => session.noteStatus?.includes("disk full") ?? false);
    expect(session.noteFor(session.current!)).toBeNull();
    expect(server.calls).toEqual([]);
    session.destroy();
  });

  it("starts from the release's saved note, and an empty note removes it", async () => {
    const { session, calls, notes, releaseNotes } = await started([1]);
    releaseNotes.set(5, "check the flip");
    session.startRound([snoozed(5, "2026-01-01T00:00:00.000Z")]);
    await until(() => session.noteFor(session.current!) === "check the flip");
    session.setNote(session.current!, " ");
    session.judge("rejected");
    await until(() => calls.includes("verdict r:5 rejected"));
    expect(notes).toEqual(["5 null"]);
    session.destroy();
  });
});

describe("hiding a label", () => {
  async function withLabels(fail = false) {
    const server = fakeServer([1, 2], { id: 88, name: "Moving Shadow" });
    const changes: string[] = [];
    const setLabelHidden = async (label: HiddenLabel, hidden: boolean) => {
      if (fail) throw new Error("disk full");
      changes.push(`${hidden ? "hide" : "show"} ${label.id} ${label.name}`);
    };
    const session = new TriageSession(server.app, { setLabelHidden });
    await session.start(50);
    return { session, changes, calls: server.calls };
  }

  it("hides the label on screen, and Z lets it back before older verdicts", async () => {
    const { session, changes, calls } = await withLabels();
    session.judge("rejected");
    await session.hideLabel();
    expect(changes).toEqual(["hide 88 Moving Shadow"]);
    expect(session.slip).toMatchObject({ kind: "label", label: "Moving Shadow" });
    session.undo();
    await until(() => changes.length === 2);
    expect(changes).toEqual(["hide 88 Moving Shadow", "show 88 Moving Shadow"]);
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
      discogs: { collection: 0, wantlist: 0, list: 0 },
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
