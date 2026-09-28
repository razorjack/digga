import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAppApi, type Api } from "../src/client/api.ts";
import { TwelvesShelf } from "../src/client/twelves/shelf.svelte.ts";
import {
  compareNullable,
  countShelves,
  visibleItems,
  visibleTracks,
} from "../src/client/twelves/model.ts";
import type { MarkedTrack, TwelvesItem, VerdictInput } from "../src/shared/api.ts";
import type { TrackMark, Verdict } from "../src/shared/types.ts";
import { queueItem } from "./helpers/catalog.ts";

function record(id: number): TwelvesItem {
  return {
    release: queueItem(id),
    onWantlist: false,
    verdict: {
      key: `r:${id}`,
      status: "maybe",
      source: "triage",
      releaseId: id,
      notes: null,
      decidedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function marked(id: number, position: string, mark: TrackMark, decidedAt: string): MarkedTrack {
  return {
    mark: { releaseId: id, position, mark, notes: null, decidedAt },
    track: { artistDisplay: `Artist ${id}`, title: `Tune ${position}`, durationSeconds: 300 },
    release: queueItem(id),
    verdict: null,
  };
}

const shelves: TwelvesShelf[] = [];
afterEach(() => {
  for (const shelf of shelves.splice(0)) shelf.destroy();
});

async function setup(sandboxMode = false) {
  let item = record(1);
  const calls: string[] = [];
  const http = {
    mode: "live",
    getTwelves: vi.fn(async () => ({ items: [item] })),
    getTrackMarks: vi.fn(async () => ({ items: [] })),
    postVerdict: vi.fn(async (input: VerdictInput): Promise<Verdict> => {
      calls.push(input.status);
      item = { ...item, verdict: { ...item.verdict, ...input } };
      return item.verdict;
    }),
    pushToWantlist: vi.fn(async () => {
      calls.push("push");
      item = { ...item, onWantlist: true };
    }),
    removeFromWantlist: vi.fn(async () => {
      calls.push("remove");
      item = { ...item, onWantlist: false };
    }),
  };
  const sandboxWrites = {
    postVerdict: vi.fn(async (input: VerdictInput): Promise<Verdict> => ({
      ...item.verdict,
      ...input,
    })),
    pushToWantlist: vi.fn(async () => ({ releaseId: 1, ok: true })),
  };
  const app = createAppApi(http as unknown as Api, (inner) => ({
    ...inner,
    ...sandboxWrites,
    mode: "sandbox",
  }));
  app.setSandbox(sandboxMode);
  const shelf = new TwelvesShelf(app);
  shelves.push(shelf);
  await shelf.load();
  return { shelf, http, app, calls, sandboxWrites };
}

describe("Twelves changes", () => {
  it("serializes rejudging and undo with their wantlist writes", async () => {
    const { shelf, calls } = await setup();
    const item = shelf.items[0]!;
    shelf.rejudge(item, "accepted");
    shelf.rejudge(item, "rejected");
    shelf.enqueueTask(() => shelf.undo());
    await shelf.changes;
    expect(calls).toEqual(["accepted", "push", "rejected", "remove", "accepted", "push"]);
    expect(shelf.items[0]).toMatchObject({ verdict: { status: "accepted" }, onWantlist: true });
  });

  it("preserves undo history when saving an undo fails", async () => {
    const { shelf, http } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    http.postVerdict.mockRejectedValueOnce(new Error("disk full"));
    await shelf.undo();
    expect(shelf.undoStack).toHaveLength(1);
    expect(shelf.items[0]?.verdict.status).toBe("accepted");
    expect(http.removeFromWantlist).not.toHaveBeenCalled();
    await shelf.undo();
    expect(shelf.undoStack).toHaveLength(0);
    expect(shelf.items[0]?.verdict.status).toBe("maybe");
  });

  it("keeps a successful write locally when its reload fails", async () => {
    const { shelf, http } = await setup();
    http.getTwelves.mockRejectedValueOnce(new Error("reload failed"));
    shelf.rejudge(shelf.items[0]!, "snoozed");
    await shelf.changes;
    expect(shelf.items[0]?.verdict.status).toBe("snoozed");
    expect(shelf.error).toBe("reload failed");
  });

  it("pins queued writes to their original API mode", async () => {
    const { shelf, app, http, sandboxWrites } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    app.setSandbox(true);
    await shelf.changes;
    expect(http.postVerdict).toHaveBeenCalledTimes(1);
    expect(http.pushToWantlist).toHaveBeenCalledTimes(1);
    expect(sandboxWrites.postVerdict).not.toHaveBeenCalled();
    expect(sandboxWrites.pushToWantlist).not.toHaveBeenCalled();
    expect(shelf.flash).toBeNull();
  });

  it("never sends queued sandbox writes to the live API after switching modes", async () => {
    const { shelf, app, http, sandboxWrites } = await setup(true);
    shelf.rejudge(shelf.items[0]!, "accepted");
    app.setSandbox(false);
    await shelf.changes;
    expect(sandboxWrites.postVerdict).toHaveBeenCalledTimes(1);
    expect(sandboxWrites.pushToWantlist).toHaveBeenCalledTimes(1);
    expect(http.postVerdict).not.toHaveBeenCalled();
    expect(http.pushToWantlist).not.toHaveBeenCalled();
  });
});

describe("Twelves filtering and ordering", () => {
  it("combines shelf and case-insensitive note matching without changing input order", () => {
    const items = [record(1), record(2)];
    items[0]!.verdict.notes = "Radio recording";
    items[1]!.verdict.status = "snoozed";
    const visible = visibleItems(items, { shelf: "maybe", query: " RADIO ", sort: "newest" });
    expect(visible.map((item) => item.verdict.key)).toEqual(["r:1"]);
    expect(items.map((item) => item.verdict.key)).toEqual(["r:1", "r:2"]);
  });

  it("keeps missing numbers last in either sort direction", () => {
    expect(compareNullable(null, 1, -1)).toBe(1);
    expect(compareNullable(1, null, 1)).toBe(-1);
    expect(compareNullable(null, null, 1)).toBe(0);
    const items = [record(1), record(2), record(3)];
    items[1]!.release!.communityWant = 10;
    items[2]!.release!.communityWant = 20;
    expect(
      visibleItems(items, { shelf: "all", query: "", sort: "want" }).map(
        (item) => item.verdict.key,
      ),
    ).toEqual(["r:3", "r:2", "r:1"]);
  });
});

describe("the Tracks shelf", () => {
  const tracks = [
    marked(2, "A1", "keep", "2026-01-02T00:00:00.000Z"),
    marked(1, "B1", "candidate", "2026-01-01T00:00:00.000Z"),
    marked(3, "A2", "meh", "2026-01-03T00:00:00.000Z"),
  ];

  it("lists grail and keep marks, not meh, newest first", () => {
    const visible = visibleTracks(tracks, { sort: "newest", query: "" });
    expect(visible.map((track) => track.mark.position)).toEqual(["A1", "B1"]);
    expect(countShelves([], tracks).tracks).toBe(2);
  });

  it("filters on the track and its release and sorts like the records", () => {
    expect(visibleTracks(tracks, { sort: "newest", query: "tune b1" })).toHaveLength(1);
    expect(visibleTracks(tracks, { sort: "newest", query: "artist 2" })).toHaveLength(1);
    const byArtist = visibleTracks(tracks, { sort: "artist", query: "" });
    expect(byArtist.map((track) => track.mark.releaseId)).toEqual([1, 2]);
  });
});
