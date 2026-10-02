import type { YTPlayer, YTPlayerOptions } from "../../../src/client/player/youtube.ts";

/**
 * A stand-in for the YouTube IFrame API, installed by an init script before the app's first line
 * (docs/e2e/FIXTURES.md#the-fake-youtube-iframe-api). `loadYouTubeApi()` finds `window.YT`
 * and loads nothing. The functions and the class below run in the page: fakeYouTubeScript()
 * sends their source, so they may use nothing from this module at run time.
 */

export interface FakeVideo {
  title: string;
  seconds: number;
}

export interface FakePlayerSnapshot {
  videoId: string | null;
  state: number;
  time: number;
  muted: boolean;
}

export interface FakeLoad {
  kind: "load" | "cue";
  videoId: string;
  startSeconds: number;
  muted: boolean;
}

interface FakeYouTubeState {
  videos: Record<string, FakeVideo>;
  /** The page's user activation as the harness decides it; the app reads only hasBeenActive. */
  activation: { hasBeenActive: boolean; isActive: boolean };
  players: FakePlayer[];
  loads: FakeLoad[];
  refused: Record<string, number>;
  soundBlocked: boolean;
}

export interface FakeYouTubeApi {
  players(): FakePlayerSnapshot[];
  audible(): string | null;
  loads(): FakeLoad[];
  end(): void;
  fail(videoId: string, code: number): void;
  blockSound(): void;
}

declare global {
  interface Window {
    __fakeYouTube?: FakeYouTubeApi;
    __fakeYouTubeState?: FakeYouTubeState;
  }
}

/** The init script: the page-side code below, then a call with the catalogue's videos. */
export function fakeYouTubeScript(videos: Record<string, FakeVideo>): string {
  const parts = [fakeState, installUserActivation, refusalCode, FakePlayer, fakeYouTubeApi];
  return `(() => {
    ${parts.map((part) => part.toString()).join("\n")}
    (${installFakeYouTube.toString()})(${JSON.stringify(videos)});
  })();`;
}

function installFakeYouTube(videos: Record<string, FakeVideo>): void {
  // The fake players' iframes run this script too; only the app's window needs the fake.
  if (window.top !== window) return;
  window.__fakeYouTubeState = {
    videos,
    activation: { hasBeenActive: false, isActive: false },
    players: [],
    loads: [],
    refused: {},
    soundBlocked: false,
  };
  installUserActivation();
  const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  Object.assign(window, { YT: { Player: FakePlayer, PlayerState } });
  window.__fakeYouTube = fakeYouTubeApi();
  setInterval(() => fakeState().players.forEach((player) => player.checkEnded()), 200);
}

function fakeState(): FakeYouTubeState {
  return window.__fakeYouTubeState!;
}

/**
 * Chromium counts every Playwright call that evaluates in the page as a user gesture, so the real
 * flag would depend on when a test first looked at the page. This one turns active on the first
 * trusted keydown other than Escape, or pointerdown, as the HTML standard's activation does.
 */
function installUserActivation(): void {
  const { activation } = fakeState();
  Object.defineProperty(Navigator.prototype, "userActivation", {
    configurable: true,
    get: () => activation,
  });
  const activate = (event: Event) => {
    if (event.isTrusted) activation.hasBeenActive = true;
  };
  window.addEventListener("keydown", (event) => event.key !== "Escape" && activate(event), true);
  window.addEventListener("pointerdown", activate, true);
}

/** YouTube's error code for a video the fake refuses: by id prefix, or set by a test. */
function refusalCode(videoId: string): number | null {
  const set = fakeState().refused[videoId];
  if (set !== undefined) return set;
  if (videoId.startsWith("e150")) return 150;
  if (videoId.startsWith("e100")) return 100;
  return null;
}

class FakePlayer implements YTPlayer {
  iframe: HTMLIFrameElement;
  events: NonNullable<YTPlayerOptions["events"]>;
  videoId: string | null;
  state: number;
  muted: boolean;
  refused: boolean;
  /** Seconds into the video when playback last started or stopped. */
  position: number;
  playingSince: number | null;

  constructor(slot: HTMLElement, options: YTPlayerOptions) {
    this.iframe = document.createElement("iframe");
    this.iframe.srcdoc = "<button>Fake YouTube player</button>";
    this.iframe.title = "Fake YouTube player, empty";
    slot.replaceWith(this.iframe);
    this.events = options.events ?? {};
    this.videoId = null;
    this.state = -1;
    this.muted = false;
    this.refused = false;
    this.position = 0;
    this.playingSince = null;
    fakeState().players.push(this);
    setTimeout(() => this.events.onReady?.(), 0);
  }

  cueVideoById(options: { videoId: string; startSeconds?: number }): void {
    this.open(options, "cue");
    this.setState(5);
  }

  loadVideoById(options: { videoId: string; startSeconds?: number }): void {
    this.open(options, "load");
    this.setState(3);
    setTimeout(() => this.startIfAllowed(), 50);
  }

  playVideo(): void {
    if (this.state !== 1) this.startIfAllowed();
  }

  pauseVideo(): void {
    if (this.state !== 1) return;
    this.position = this.getCurrentTime();
    this.playingSince = null;
    this.setState(2);
  }

  stopVideo(): void {
    this.position = 0;
    this.playingSince = null;
    this.setState(5);
  }

  seekTo(seconds: number): void {
    this.position = seconds;
    if (this.playingSince !== null) this.playingSince = performance.now();
  }

  mute(): void {
    this.muted = true;
  }

  unMute(): void {
    this.muted = false;
  }

  getCurrentTime(): number {
    if (this.playingSince === null) return this.position;
    const elapsed = (performance.now() - this.playingSince) / 1000;
    return Math.min(this.getDuration(), this.position + elapsed);
  }

  getDuration(): number {
    if (this.videoId === null) return 0;
    return fakeState().videos[this.videoId]?.seconds ?? 300;
  }

  getPlayerState(): number {
    return this.state;
  }

  getVideoData(): { video_id?: string } {
    return this.videoId === null ? {} : { video_id: this.videoId };
  }

  destroy(): void {
    this.iframe.remove();
    const { players } = fakeState();
    players.splice(players.indexOf(this), 1);
  }

  open(options: { videoId: string; startSeconds?: number }, kind: "load" | "cue"): void {
    this.videoId = options.videoId;
    this.iframe.title = `Fake YouTube player, ${options.videoId}`;
    this.position = options.startSeconds ?? 0;
    this.playingSince = null;
    fakeState().loads.push({
      kind,
      videoId: options.videoId,
      startSeconds: this.position,
      muted: this.muted,
    });
    const code = refusalCode(options.videoId);
    this.refused = code !== null;
    if (code !== null) setTimeout(() => this.events.onError?.({ data: code }), 0);
  }

  /** Sound needs the page's activation, as browsers require; muted playback does not. */
  startIfAllowed(): void {
    if (this.refused || this.videoId === null) return;
    const { activation, soundBlocked } = fakeState();
    if (!this.muted && !(activation.hasBeenActive && !soundBlocked)) {
      this.setState(-1);
      return;
    }
    this.playingSince = performance.now();
    this.setState(1);
  }

  checkEnded(): void {
    if (this.state !== 1 || this.getCurrentTime() < this.getDuration()) return;
    this.position = this.getDuration();
    this.playingSince = null;
    this.setState(0);
  }

  setState(state: number): void {
    this.state = state;
    this.events.onStateChange?.({ data: state });
  }
}

function fakeYouTubeApi(): FakeYouTubeApi {
  const state = fakeState();
  const audiblePlayer = () => state.players.find((player) => player.state === 1 && !player.muted);
  return {
    players: () =>
      state.players.map((player) => ({
        videoId: player.videoId,
        state: player.state,
        time: player.getCurrentTime(),
        muted: player.muted,
      })),
    audible: () => audiblePlayer()?.videoId ?? null,
    loads: () => [...state.loads],
    end: () => {
      const player = audiblePlayer();
      if (player) player.seekTo(player.getDuration());
      player?.checkEnded();
    },
    fail: (videoId, code) => {
      state.refused[videoId] = code;
      for (const player of state.players)
        if (player.videoId === videoId) player.events.onError?.({ data: code });
    },
    blockSound: () => {
      state.soundBlocked = true;
    },
  };
}
