import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiRequestError, type Api } from "../src/client/api.ts";
import { TwelvesShelf } from "../src/client/twelves/shelf.svelte.ts";
import {
  columnSort,
  compareNullable,
  countShelves,
  notOnWantlist,
  pageAround,
  PAGE_SIZE,
  rejudgedSentence,
  replayedItems,
  unchangedSentence,
  turnedPageStart,
  visibleItems,
  visibleTracks,
} from "../src/client/twelves/model.ts";
import type { MarkedTrack, TwelvesItem, VerdictInput } from "../src/shared/api.ts";
import type { TrackMark, Verdict } from "../src/shared/types.ts";
import { queueItem } from "./helpers/catalog.ts";

const decidedAt = "2026-01-01T00:00:00.000Z";

/** A record decided in Digga as a maybe, which the Discogs account does not hold. */
function record(id: number): TwelvesItem & { verdict: Verdict } {
  return {
    key: `r:${id}`,
    release: queueItem(id),
    verdict: { key: `r:${id}`, status: "maybe", source: "triage", releaseId: id, decidedAt },
    membership: {
      owned: false,
      onWantlist: false,
      wantlistReleaseIds: [],
      onList: false,
      wantRemoved: false,
    },
    since: decidedAt,
    note: null,
    pressingNotes: [],
  };
}

function marked(id: number, position: string, mark: TrackMark, decidedAt: string): MarkedTrack {
  return {
    mark: {
      releaseId: id,
      position,
      mark,
      notes: null,
      decidedAt,
      heardKey: `artist ${id} - tune ${position}`,
      videoId: null,
      atSeconds: null,
    },
    track: { artistDisplay: `Artist ${id}`, title: `Tune ${position}`, durationSeconds: 300 },
    release: queueItem(id),
    verdict: null,
  };
}

const shelves: TwelvesShelf[] = [];
afterEach(() => {
  for (const shelf of shelves.splice(0)) shelf.destroy();
});

async function setup() {
  let item = record(1);
  const calls: string[] = [];
  const http = {
    getTwelves: vi.fn(async () => ({ items: [item] })),
    getTrackMarks: vi.fn(async () => ({ items: [] })),
    postVerdict: vi.fn(async (input: VerdictInput): Promise<Verdict> => {
      calls.push(input.status);
      item = { ...item, verdict: { ...item.verdict, ...input } };
      return item.verdict;
    }),
    pushToWantlist: vi.fn(async () => {
      calls.push("push");
      item = {
        ...item,
        membership: { ...item.membership, onWantlist: true, wantlistReleaseIds: [1] },
      };
    }),
    removeFromWantlist: vi.fn(async () => {
      calls.push("remove");
      item = {
        ...item,
        membership: { ...item.membership, onWantlist: false, wantlistReleaseIds: [] },
      };
    }),
  };
  const shelf = new TwelvesShelf(http as unknown as Api);
  shelves.push(shelf);
  await shelf.load();
  return { shelf, http, calls };
}

describe("Twelves changes", () => {
  it("limits bulk wantlist additions to the current search", async () => {
    const { shelf } = await setup();
    shelf.items = [record(1), record(2)].map((item) => ({
      ...item,
      verdict: { ...item.verdict, status: "accepted" },
    }));
    shelf.query = "Artist 1";
    expect(shelf.wantsPending.map((item) => item.key)).toEqual(["r:1"]);
    shelf.query = "nothing matches";
    expect(shelf.wantsPending).toEqual([]);
    shelf.query = "";
    expect(shelf.wantsPending).toHaveLength(2);
  });

  it("serializes rejudging and undo with their wantlist writes", async () => {
    const { shelf, calls } = await setup();
    const item = shelf.items[0]!;
    shelf.rejudge(item, "accepted");
    shelf.rejudge(item, "rejected");
    shelf.enqueueTask(() => shelf.undo());
    await shelf.changes;
    expect(calls).toEqual(["accepted", "push", "rejected", "remove", "accepted", "push"]);
    expect(shelf.items[0]).toMatchObject({
      verdict: { status: "accepted" },
      membership: { onWantlist: true },
    });
  });

  it("keeps a grail on the wantlist like a want, and takes it off for anything else", async () => {
    const { shelf, calls } = await setup();
    shelf.rejudge(shelf.items[0]!, "candidate");
    await shelf.changes;
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    shelf.rejudge(shelf.items[0]!, "candidate");
    await shelf.changes;
    expect(calls).toEqual(["candidate", "push", "accepted", "candidate"]);
    shelf.rejudge(shelf.items[0]!, "snoozed");
    await shelf.changes;
    expect(calls.slice(4)).toEqual(["snoozed", "remove"]);
    expect(shelf.items[0]).toMatchObject({
      verdict: { status: "snoozed" },
      membership: { onWantlist: false },
    });
  });

  it("offers to add a grail made before grails were pushed", async () => {
    const { shelf, calls } = await setup();
    shelf.items = [
      { ...shelf.items[0]!, verdict: { ...shelf.items[0]!.verdict!, status: "candidate" } },
    ];
    shelf.shelf = "candidate";
    expect(shelf.wantsPending).toHaveLength(1);
    shelf.shelf = "accepted";
    expect(shelf.wantsPending).toHaveLength(0);
    shelf.rejudge(shelf.items[0]!, "candidate");
    await shelf.changes;
    expect(calls).toEqual(["push"]);
  });

  it("preserves undo history when saving an undo fails", async () => {
    const { shelf, http } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    http.postVerdict.mockRejectedValueOnce(new Error("disk full"));
    await shelf.undo();
    expect(shelf.undoStack).toHaveLength(1);
    expect(shelf.items[0]?.verdict?.status).toBe("accepted");
    expect(http.removeFromWantlist).not.toHaveBeenCalled();
    await shelf.undo();
    expect(shelf.undoStack).toHaveLength(0);
    expect(shelf.items[0]?.verdict?.status).toBe("maybe");
  });

  it("expects the verdict it read, and drops an undo once another tab decided the record again", async () => {
    const { shelf, http } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    expect(http.postVerdict).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "accepted", expected: { status: "maybe", decidedAt } }),
    );

    http.postVerdict.mockRejectedValueOnce(
      new ApiRequestError(409, "The record's verdict changed since this page read it"),
    );
    await shelf.undo();
    expect(http.postVerdict).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "maybe", expected: { status: "accepted", decidedAt } }),
    );
    expect(shelf.flash).toBe("Undo failed: The record's verdict changed since this page read it");
    expect(shelf.undoStack).toHaveLength(0);
  });

  it("keeps a successful write locally when its reload fails", async () => {
    const { shelf, http } = await setup();
    http.getTwelves.mockRejectedValueOnce(new Error("reload failed"));
    shelf.rejudge(shelf.items[0]!, "snoozed");
    await shelf.changes;
    expect(shelf.items[0]?.verdict?.status).toBe("snoozed");
    expect(shelf.error).toBe("reload failed");
  });
});

describe("the flash after re-judging", () => {
  it("says which shelf the record moved to, or that a skip took it off the shelves", () => {
    const name = "Kestrel – Day Break";
    expect(rejudgedSentence(name, "accepted")).toBe("Kestrel – Day Break moved to Want.");
    expect(rejudgedSentence(name, "candidate")).toBe("Kestrel – Day Break moved to Grail.");
    expect(rejudgedSentence(name, "maybe")).toBe("Kestrel – Day Break moved to Maybe.");
    expect(rejudgedSentence(name, "snoozed")).toBe("Kestrel – Day Break moved to Snoozed.");
    expect(rejudgedSentence(name, "no_audio")).toBe("Kestrel – Day Break moved to No audio.");
    expect(rejudgedSentence(name, "rejected")).toBe(
      "Kestrel – Day Break skipped, off the shelves.",
    );
  });

  it("says a re-judgement to the same verdict changes nothing", () => {
    const want = { ...record(1), verdict: { ...record(1).verdict, status: "accepted" as const } };
    const onWantlist = { ...want, membership: { ...want.membership, onWantlist: true } };
    expect(unchangedSentence(onWantlist, "accepted")).toBe("Already on your Discogs wantlist.");
    expect(
      unchangedSentence({ ...want, membership: { ...want.membership, owned: true } }, "accepted"),
    ).toBe("Already on the Want shelf.");
    expect(unchangedSentence(record(1), "maybe")).toBe("Already on the Maybe shelf.");
    expect(unchangedSentence(record(1), "rejected")).toBe("Already skipped.");
  });

  it("writes nothing for a want already on the wantlist, and says so", async () => {
    const { shelf, calls } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    calls.length = 0;
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    expect(calls).toEqual([]);
    expect(shelf.flash).toBe("Already on your Discogs wantlist.");
  });

  it("follows the re-judgement with the wantlist change and the undo", async () => {
    const { shelf } = await setup();
    shelf.rejudge(shelf.items[0]!, "accepted");
    await shelf.changes;
    expect(shelf.flash).toBe(
      `${rejudgedSentence("Artist 1 – Title 1", "accepted")} Added to your Discogs wantlist. Z undoes it.`,
    );
  });
});

describe("Twelves filtering and ordering", () => {
  it("combines shelf and case-insensitive note matching without changing input order", () => {
    const items = [record(1), record(2)];
    items[0]!.note = "Radio recording";
    items[1]!.verdict.status = "snoozed";
    const visible = visibleItems(items, { shelf: "maybe", query: " RADIO ", sort: "newest" });
    expect(visible.map((item) => item.key)).toEqual(["r:1"]);
    expect(items.map((item) => item.key)).toEqual(["r:1", "r:2"]);
  });

  it("keeps missing numbers last in either sort direction", () => {
    expect(compareNullable(null, 1, -1)).toBe(1);
    expect(compareNullable(1, null, 1)).toBe(-1);
    expect(compareNullable(null, null, 1)).toBe(0);
    const items = [record(1), record(2), record(3)];
    items[1]!.release!.communityWant = 10;
    items[2]!.release!.communityWant = 20;
    expect(
      visibleItems(items, { shelf: "all", query: "", sort: "want" }).map((item) => item.key),
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

describe("the No audio shelf", () => {
  const silent = { ...record(2), verdict: { ...record(2).verdict, status: "no_audio" as const } };

  it("keeps records without audio off Everything", () => {
    const counts = countShelves([record(1), silent], []);
    expect([counts.all, counts.no_audio]).toEqual([1, 1]);
    const options = { sort: "newest" as const, query: "" };
    expect(visibleItems([record(1), silent], { ...options, shelf: "all" })).toHaveLength(1);
    expect(visibleItems([record(1), silent], { ...options, shelf: "no_audio" })).toEqual([silent]);
  });
});

describe("shelves as filters", () => {
  const options = { sort: "newest" as const, query: "" };
  const shelvesOf = (item: TwelvesItem) =>
    (["all", "accepted", "candidate", "wantlist", "collection", "maybe"] as const).filter(
      (shelf) => visibleItems([item], { ...options, shelf }).length > 0,
    );
  const want = (membership: Partial<TwelvesItem["membership"]>): TwelvesItem => ({
    ...record(1),
    verdict: { ...record(1).verdict, status: "accepted" },
    membership: { ...record(1).membership, ...membership },
  });

  it("puts a pushed want on Want and on the Discogs wantlist, and an owned one on Owned only", () => {
    expect(shelvesOf(want({ onWantlist: true }))).toEqual(["all", "accepted", "wantlist"]);
    expect(shelvesOf(want({ owned: true }))).toEqual(["all", "collection"]);
    expect(notOnWantlist(want({ owned: true }))).toBe(false);
  });

  it("ends a want taken off the wantlist on Discogs, without offering to push it again", () => {
    const removed = want({ wantRemoved: true });
    expect(shelvesOf(removed)).toEqual([]);
    expect(notOnWantlist(removed)).toBe(false);
    expect(notOnWantlist(want({}))).toBe(true);
  });

  it("shows a record only the Discogs account holds on its shelves, without a verdict", () => {
    const listed: TwelvesItem = {
      ...record(1),
      verdict: null,
      membership: { ...record(1).membership, onList: true },
    };
    expect(shelvesOf(listed)).toEqual(["all", "maybe"]);
  });
});

describe("pages", () => {
  it("shows the page that holds the selection", () => {
    const list = [1, 2, 3, 4, 5];
    expect(pageAround(list, -1, 2)).toEqual({
      items: [1, 2],
      index: 0,
      count: 3,
      first: 1,
      last: 2,
      total: 5,
    });
    expect(pageAround(list, 4, 2)).toMatchObject({ items: [5], index: 2, first: 5, last: 5 });
    expect(pageAround([], -1, 2)).toMatchObject({ items: [], count: 1, first: 0, last: 0 });
  });

  it("turns to the start of the page before or after, and not past either end", () => {
    expect(turnedPageStart(5, 0, 1, 2)).toBe(2);
    expect(turnedPageStart(5, 3, 1, 2)).toBe(4);
    expect(turnedPageStart(5, 4, 1, 2)).toBeNull();
    expect(turnedPageStart(5, 3, -1, 2)).toBe(0);
    expect(turnedPageStart(5, -1, -1, 2)).toBeNull();
  });

  it("lets J cross into the next page and the arrows turn whole pages", async () => {
    const items = Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, index) => record(index + 1));
    const http = {
      getTwelves: async () => ({ items }),
      getTrackMarks: async () => ({ items: [] }),
    };
    const shelf = new TwelvesShelf(http as unknown as Api);
    shelves.push(shelf);
    await shelf.load();
    shelf.selectedKey = items[PAGE_SIZE - 1]!.key;
    expect(shelf.page).toMatchObject({ index: 0, first: 1, last: PAGE_SIZE });
    shelf.move(1);
    expect(shelf.page).toMatchObject({ index: 1, first: PAGE_SIZE + 1 });
    shelf.turnPage(1);
    expect(shelf.selected).toBe(items[PAGE_SIZE * 2]);
    expect(shelf.page).toMatchObject({ index: 2, count: 3, items: [items[PAGE_SIZE * 2]] });
    shelf.turnPage(1);
    expect(shelf.page.index).toBe(2);
    shelf.turnPage(-1);
    expect(shelf.selected).toBe(items[PAGE_SIZE]);
  });
});

describe("replayedItems", () => {
  const shelf = [record(1), record(2), { ...record(3), release: null }, record(4)];
  const ids = (items: TwelvesItem[]) => items.map((item) => item.key);

  it("replays the selected record alone, or from it to the end of the shelf", () => {
    expect(ids(replayedItems(shelf, { index: 1, shelf: "all", range: "selected" }))).toEqual([
      "r:2",
    ]);
    expect(ids(replayedItems(shelf, { index: 1, shelf: "all", range: "to the end" }))).toEqual([
      "r:2",
      "r:4",
    ]);
  });

  it("starts a round to the end on the snoozed shelf", () => {
    const replayed = replayedItems(shelf, { index: 0, shelf: "snoozed", range: "selected" });
    expect(ids(replayed)).toEqual(["r:1", "r:2", "r:4"]);
  });

  it("replays nothing without a selection or a record in the dump", () => {
    expect(replayedItems(shelf, { index: -1, shelf: "all", range: "to the end" })).toEqual([]);
    expect(replayedItems(shelf, { index: 2, shelf: "all", range: "selected" })).toEqual([]);
  });
});

describe("columnSort", () => {
  it("marks the column each order sorts, and which way", () => {
    expect(columnSort("newest", "decided")).toBe("descending");
    expect(columnSort("artist", "record")).toBe("ascending");
    expect(columnSort("label", "label")).toBe("ascending");
    expect(columnSort("year", "label")).toBe("ascending");
    expect(columnSort("price", "market")).toBe("ascending");
    expect(columnSort("want", "market")).toBe("descending");
  });

  it("leaves the other columns unmarked", () => {
    expect(columnSort("newest", "record")).toBeUndefined();
    expect(columnSort("price", "label")).toBeUndefined();
  });
});
