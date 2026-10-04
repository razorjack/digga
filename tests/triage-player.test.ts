import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Deck, DeckListener } from "../src/client/player/deck.ts";
import { createAppApi, type Api } from "../src/client/api.ts";
import { TriagePlayer } from "../src/client/player/triage-player.svelte.ts";
import { PlayerState } from "../src/client/player/youtube.ts";
import type { ReleaseDetail } from "../src/shared/api.ts";
import type { ReleaseRecord } from "../src/shared/types.ts";

const fake = vi.hoisted(() => {
  const decks: FakeDeck[] = [];
  class FakeDeck {
    id: number;
    listener: DeckListener;
    tag: { releaseId: number; entry: number } | null = null;
    videoId: string | null = null;
    state = -1;
    primed = false;
    ready = true;
    load = vi.fn(async (video: { videoId: string }) => {
      this.videoId = video.videoId;
    });
    play = vi.fn();
    pause = vi.fn();
    park = vi.fn(() => {
      this.tag = null;
      this.videoId = null;
    });
    destroy = vi.fn();
    currentTime = () => 0;
    duration = () => 300;
    constructor(id: number, _host: unknown, _yt: unknown, listener: DeckListener) {
      this.id = id;
      this.listener = listener;
      decks.push(this);
    }
    emitState(state: number): void {
      this.listener.onState(this as unknown as Deck, state);
    }
    emitError(videoId: string): void {
      this.listener.onError(this as unknown as Deck, 101, videoId);
    }
  }
  return { decks, FakeDeck };
});

vi.mock("../src/client/player/deck.ts", () => ({ Deck: fake.FakeDeck }));
vi.mock("../src/client/player/youtube.ts", async (original) => ({
  ...(await original<typeof import("../src/client/player/youtube.ts")>()),
  loadYouTubeApi: async () => ({}),
}));

const players: TriagePlayer[] = [];
beforeEach(() => {
  fake.decks.length = 0;
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
});
afterEach(() => {
  for (const player of players.splice(0)) player.destroy();
  vi.unstubAllGlobals();
});

function detail(id: number): ReleaseDetail {
  return {
    release: { id } as ReleaseRecord,
    tracks: [],
    trackVerdicts: [],
    siblings: [],
    listings: [],
    verdict: null,
    pressingNotes: [],
    videos: [
      {
        releaseId: id,
        videoId: `video-${id}`,
        src: "",
        title: "Tune",
        durationSeconds: 300,
        embeddable: true,
        matchedPosition: null,
      },
    ],
  };
}

/** A release with a video for each of the given ids. */
function withVideos(id: number, videoIds: string[]): ReleaseDetail {
  const base = detail(id);
  return { ...base, videos: videoIds.map((videoId) => ({ ...base.videos[0]!, videoId })) };
}

/** The arguments Deck.load() gets for a 300-second video started halfway. */
function deckLoad(videoId: string, mode: string) {
  return [expect.objectContaining({ videoId, durationSeconds: 300 }), mode, { fraction: 0.5 }];
}

async function setup() {
  const http = { mode: "live", postListenLog: vi.fn(async () => ({})) } as unknown as Api;
  const player = new TriagePlayer(
    createAppApi(http, (inner) => inner),
    {
      startAtFraction: () => 0.5,
    },
  );
  players.push(player);
  player.show(detail(1), detail(2));
  await player.mount([{}, {}, {}] as Parameters<TriagePlayer["mount"]>[0]);
  return player;
}

describe("player deck ownership", () => {
  it("adopts the next release's preload without loading it again", async () => {
    const player = await setup();
    const [first, second] = fake.decks;
    expect(second!.load).toHaveBeenCalledWith(...deckLoad("video-2", "preload"));
    player.show(detail(2), detail(3));
    expect(player.active).toBe(1);
    expect(player.entry?.video.videoId).toBe("video-2");
    expect(second!.load).toHaveBeenCalledTimes(1);
    expect(second!.play).toHaveBeenCalledTimes(1);
    expect(first!.load).toHaveBeenLastCalledWith(...deckLoad("video-3", "preload"));
  });

  it("keeps a promoted preload silent while the page is suspended", async () => {
    const player = await setup();
    player.suspend(true);
    player.show(detail(2), null);
    expect(player.status).toBe("paused");
    expect(fake.decks[1]!.play).not.toHaveBeenCalled();
  });

  it("ignores late errors for an earlier video and state from a parked release", async () => {
    const player = await setup();
    player.show(detail(2), detail(3));
    const active = fake.decks[1]!;
    active.emitState(PlayerState.PLAYING);
    active.emitError("old-video");
    fake.decks[0]!.emitState(PlayerState.ENDED);
    expect(player.status).toBe("playing");
    expect(player.entry?.video.videoId).toBe("video-2");
    expect(player.failed.has("old-video")).toBe(true);
    player.show(null, null);
    active.emitState(PlayerState.PLAYING);
    expect(player.status).toBe("idle");
  });

  it("ignores callbacks after destruction", async () => {
    const player = await setup();
    const active = fake.decks[0]!;
    player.destroy();
    const before = player.status;
    active.emitState(PlayerState.PLAYING);
    active.emitError("video-1");
    expect(player.status).toBe(before);
    expect(player.failed.size).toBe(0);
  });

  it("plays a video attached to the open release, and starts a release that had none", async () => {
    const player = await setup();
    const active = fake.decks[0]!;
    const attached = detail(1);
    attached.videos.push({ ...attached.videos[0]!, videoId: "pasted" });
    player.show(attached, detail(2));
    expect(active.load).toHaveBeenLastCalledWith(...deckLoad("pasted", "play"));
    expect(player.entry?.video.videoId).toBe("pasted");

    const silent = { ...detail(3), videos: [] };
    player.show(silent, null);
    expect(player.status).toBe("no_audio");
    player.show({ ...silent, videos: [{ ...detail(3).videos[0]!, videoId: "found" }] }, null);
    expect(player.entry?.video.videoId).toBe("found");
    expect(player.status).toBe("loading");
  });
});

describe("the track deck", () => {
  it("buffers the next track and swaps it in on J", async () => {
    const player = await setup();
    player.show(withVideos(5, ["a", "b", "c"]), detail(6));
    const [first, second, third] = fake.decks;
    expect(first!.load).toHaveBeenLastCalledWith(...deckLoad("a", "play"));
    expect(third!.load).toHaveBeenLastCalledWith(...deckLoad("b", "preload"));

    player.nextTrack();
    expect(player.active).toBe(2);
    expect(player.entry?.video.videoId).toBe("b");
    expect(third!.load).toHaveBeenCalledTimes(1);
    expect(third!.play).toHaveBeenCalledTimes(1);
    // The deck that played "a" now buffers "c"; the next release stays buffered.
    expect(first!.load).toHaveBeenLastCalledWith(...deckLoad("c", "preload"));
    expect(second!.load).toHaveBeenLastCalledWith(...deckLoad("video-6", "preload"));
  });

  it("buffers the track after one that fails to embed", async () => {
    const player = await setup();
    player.show(withVideos(5, ["a", "b", "c"]), null);
    fake.decks[2]!.emitError("b");
    expect(player.failed.has("b")).toBe(true);
    expect(fake.decks[2]!.load).toHaveBeenLastCalledWith(...deckLoad("c", "preload"));
    player.nextTrack();
    expect(player.entry?.video.videoId).toBe("c");
    expect(player.active).toBe(2);
  });

  it("keeps the three decks apart when a verdict follows J", async () => {
    const player = await setup();
    player.show(withVideos(5, ["a", "b"]), withVideos(6, ["x", "y"]));
    player.nextTrack();
    player.show(withVideos(6, ["x", "y"]), detail(7));
    expect(player.entry?.video.videoId).toBe("x");
    const holding = (videoId: string) => fake.decks.findIndex((deck) => deck.videoId === videoId);
    // Playing, next track and next release each sit on a deck of their own.
    const roles = [player.active, holding("y"), holding("video-7")];
    expect(roles).toEqual([holding("x"), expect.any(Number), expect.any(Number)]);
    expect(new Set(roles).size).toBe(3);
    expect(roles).not.toContain(-1);
  });
});
