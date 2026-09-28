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
    load = vi.fn(async (videoId: string) => {
      this.videoId = videoId;
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
    verdict: null,
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

async function setup() {
  const http = { mode: "live", postListenLog: vi.fn(async () => ({})) } as unknown as Api;
  const player = new TriagePlayer(
    createAppApi(http, (inner) => inner),
    () => 0.5,
  );
  players.push(player);
  player.show(detail(1), detail(2));
  await player.mount([{}, {}] as Parameters<TriagePlayer["mount"]>[0]);
  return player;
}

describe("player deck ownership", () => {
  it("adopts the next release's preload without loading it again", async () => {
    const player = await setup();
    const [first, second] = fake.decks;
    expect(second!.load).toHaveBeenCalledWith("video-2", 300, 0.5, "preload");
    player.show(detail(2), detail(3));
    expect(player.active).toBe(1);
    expect(player.entry?.video.videoId).toBe("video-2");
    expect(second!.load).toHaveBeenCalledTimes(1);
    expect(second!.play).toHaveBeenCalledTimes(1);
    expect(first!.load).toHaveBeenLastCalledWith("video-3", 300, 0.5, "preload");
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
});
