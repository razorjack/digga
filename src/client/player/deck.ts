import { startSeconds } from "../../shared/playlist.ts";
import { PlayerState, type YTNamespace, type YTPlayer } from "./youtube.ts";

/**
 * "play" plays with sound; "preload" buffers muted and pauses at the start offset so that
 * promote() starts instantly; "cue" loads without playing, for when the page has not had a user
 * gesture yet and the browser would block sound.
 */
export type DeckMode = "play" | "preload" | "cue";

export interface DeckListener {
  onState(deck: Deck, state: number): void;
  /** `videoId` is the video YouTube refused, which may no longer be the deck's current one. */
  onError(deck: Deck, code: number, videoId: string | null): void;
}

/** One YouTube player in a host element that the page never moves (moving an iframe reloads it). */
export class Deck {
  readonly id: number;
  videoId: string | null = null;
  /** The release and playlist entry loaded, so the release after a verdict can reuse a preload. */
  tag: { releaseId: number; entry: number } | null = null;
  state: number = PlayerState.UNSTARTED;
  /** A preload has buffered and paused at its start offset. */
  primed = false;
  ready = false;

  #player: YTPlayer;
  #readiness = Promise.withResolvers<void>();
  #listener: DeckListener;
  #mode: DeckMode = "cue";
  #fraction = 0.5;
  #seekWhenPlaying = false;
  #started = false;
  /** play() arrived before the player was ready; the pending load() must start with sound. */
  #playRequested = false;

  constructor(id: number, host: HTMLElement, yt: YTNamespace, listener: DeckListener) {
    this.id = id;
    this.#listener = listener;
    // The API replaces this element with its iframe; the host keeps its own Svelte-owned nodes.
    const slot = document.createElement("div");
    host.append(slot);
    this.#player = new yt.Player(slot, {
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        playsinline: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          this.ready = true;
          this.#readiness.resolve();
        },
        onStateChange: (e) => this.#onState(e.data),
        onError: (e) => this.#listener.onError(this, e.data, this.#erroredVideo()),
      },
    });
  }

  /**
   * Loads a video to start at `fraction` of its length, or at `atSeconds` for a saved moment.
   * `fraction` also places a video whose length is only known once it plays.
   */
  async load(
    video: { videoId: string; durationSeconds: number | null },
    requestedMode: DeckMode,
    start: { fraction: number; atSeconds?: number },
  ): Promise<void> {
    const { videoId, durationSeconds } = video;
    const { fraction, atSeconds } = start;
    let mode = requestedMode;
    this.videoId = videoId;
    this.primed = false;
    await this.#readiness.promise;
    if (this.videoId !== videoId) return;
    if (this.#playRequested) mode = "play";
    this.#playRequested = false;
    this.#mode = mode;
    this.#fraction = fraction;
    this.#started = false;
    const startAt = atSeconds ?? startSeconds(durationSeconds, fraction);
    this.#seekWhenPlaying = startAt === null;
    if (mode === "play") this.#player.unMute();
    else this.#player.mute();
    const opts = { videoId, startSeconds: startAt ?? 0 };
    if (mode === "cue") this.#player.cueVideoById(opts);
    else this.#player.loadVideoById(opts);
  }

  /** Plays with sound: a cued video, a paused one, or a preload that becomes the audible deck. */
  play(): void {
    this.#mode = "play";
    if (!this.ready) {
      this.#playRequested = true;
      return;
    }
    this.#player.unMute();
    this.#player.playVideo();
  }

  pause(): void {
    if (this.ready) this.#player.pauseVideo();
  }

  /** Silences a deck that goes into hiding; its next load() replaces the video. */
  park(): void {
    this.#mode = "preload";
    this.#playRequested = false;
    // Forgetting the video also cancels a load() still waiting for the player to be ready.
    this.videoId = null;
    this.tag = null;
    this.primed = false;
    if (!this.ready) return;
    this.#player.mute();
    this.#player.pauseVideo();
  }

  seekTo(seconds: number): void {
    if (this.ready) this.#player.seekTo(Math.max(0, seconds), true);
  }

  currentTime(): number {
    return this.ready ? this.#player.getCurrentTime() || 0 : 0;
  }

  duration(): number {
    return this.ready ? this.#player.getDuration() || 0 : 0;
  }

  /** Where playback starts for the loaded video, from the player's own duration. */
  startOffset(): number {
    return startSeconds(this.duration(), this.#fraction) ?? 0;
  }

  destroy(): void {
    this.#player.destroy();
  }

  /**
   * An error can arrive after the next load() was issued; the player's own video data still
   * names the refused video then, so the error is not charged to its successor.
   */
  #erroredVideo(): string | null {
    const reported = this.#player.getVideoData?.()?.video_id;
    return reported && /^[\w-]{11}$/.test(reported) ? reported : this.videoId;
  }

  #onState(state: number): void {
    this.state = state;
    if (state === PlayerState.PLAYING && !this.#started) {
      this.#started = true;
      if (this.#seekWhenPlaying) {
        this.#seekWhenPlaying = false;
        const at = startSeconds(this.#player.getDuration(), this.#fraction);
        if (at !== null && at > 0) this.#player.seekTo(at, true);
      }
      if (this.#mode === "preload") {
        this.#player.pauseVideo();
        this.primed = true;
      }
    }
    this.#listener.onState(this, state);
  }
}
