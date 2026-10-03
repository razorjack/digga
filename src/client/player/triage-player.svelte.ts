import { SvelteSet } from "svelte/reactivity";
import type { ListenContext, ReleaseDetail } from "../../shared/api.ts";
import {
  buildPlaylist,
  firstEntry,
  nextEntry,
  type PlaylistEntry,
  type PlaylistState,
  previousEntry,
  startSeconds,
} from "../../shared/playlist.ts";
import type { PlaybackPosition } from "../../shared/replay.ts";
import { tuneSnapshot } from "../../shared/track-identity.ts";
import type { Api, AppApi } from "../api.ts";
import { bookmarkedEntry } from "./bookmark.ts";
import { Deck, type DeckListener } from "./deck.ts";
import type { PlayerStatus } from "./status.ts";
import { embedErrorReason, loadYouTubeApi, PlayerState } from "./youtube.ts";

/** A play turns the tune heard after this many seconds; a shorter one is logged as not heard. */
const LOG_AFTER_SECONDS = 4;
/** The log keeps seconds to a tenth; a play that rounds to nothing is not logged. */
const SHORTEST_PLAY_SECONDS = 0.05;
const TICK_MS = 250;
/** How long a "play" load may sit unstarted before we assume the browser blocked sound. */
const BLOCKED_AFTER_MS = 3500;

interface Listen {
  /** The api of the mode the tune was heard in; a sandbox listen never reaches the server. */
  client: Api;
  /** Saved with each post; `startSeconds` moves to where the next post's playback starts. */
  context: ListenContext;
  releaseId: number;
  position: string | null;
  heardKey: string | null;
  videoId: string;
  seconds: number;
  logged: number;
}

export interface PlayerSettings {
  startAtFraction: () => number;
  /** Start a record on, and move forward to, tunes not heard before; true when omitted. */
  skipHeard?: () => boolean;
}

function hasUserActivation(): boolean {
  return navigator.userActivation?.hasBeenActive ?? true;
}

/**
 * Three YouTube decks: the visible one plays the release under judgement, one hidden deck buffers
 * the first video of the next release, and the other the track J moves to. A verdict or J swaps
 * the buffered deck in, so the next release or track starts at once.
 */
export class TriagePlayer {
  status = $state<PlayerStatus>("starting");
  release = $state.raw<ReleaseDetail | null>(null);
  entries = $state.raw<PlaylistEntry[]>([]);
  current = $state<number | null>(null);
  time = $state(0);
  duration = $state(0);
  /** Short message about the player, such as a video that would not embed. */
  notice = $state<string | null>(null);
  /** The first video of the next release is buffered. */
  nextReady = $state(false);
  /** Index of the visible deck, which plays the open release. */
  active = $state(0);
  /** Video ids that failed this session; a blocked embed stays blocked. */
  readonly failed = new SvelteSet<string>();
  /** Video ids played on the open release. */
  readonly played = new SvelteSet<string>();
  /** Track positions that reached a logged listen on the open release. */
  readonly heardNow = new SvelteSet<string>();
  /**
   * Tunes heard this session. Releases prefetched before the listen still carry heard = false,
   * so these are added when their playlists are built and their tracklists are shown.
   */
  readonly heardKeys = new SvelteSet<string>();

  #api: AppApi;
  #fraction: () => number;
  #skipHeard: () => boolean;
  #decks: Deck[] = [];
  /** The hidden deck that buffers the next release's first video. */
  #releaseDeck = 1;
  /** The hidden deck that buffers the track J moves to on the open release. */
  #trackDeck = 2;
  #wanted: { detail: ReleaseDetail | null; next: ReleaseDetail | null } = {
    detail: null,
    next: null,
  };
  /** Release the decks were last pointed at; undefined before the first one. */
  #openedId: number | null | undefined = undefined;
  #listen: Listen | null = null;
  /** The digging session listens are logged under; see SessionCheckpoint. */
  #sessionId: string | null = null;
  /** A saved moment to play once its release opens, from Twelves or a resumed session. */
  #pendingPlayback: PlaybackPosition | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  #lastTick = 0;
  #loadingSince = 0;
  #destroyed = false;
  /** The Triage page is hidden: load and cue, but never start sound. */
  #suspended = false;
  /** A session is being resumed: nothing starts until the listener presses play. */
  #resumePaused = false;

  constructor(api: AppApi, settings: PlayerSettings) {
    this.#api = api;
    this.#fraction = settings.startAtFraction;
    this.#skipHeard = settings.skipHeard ?? (() => true);
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  /** A new session id applies from the next listen; the playback so far is logged under the old one. */
  set sessionId(id: string | null) {
    if (id === this.#sessionId) return;
    this.#sessionId = id;
    this.#restartListen();
  }

  /** Forgets the tunes heard this session, e.g. those heard in a sandbox that was left. */
  forgetHeard(): void {
    this.heardKeys.clear();
  }

  get entry(): PlaylistEntry | null {
    return this.current === null ? null : (this.entries[this.current] ?? null);
  }

  async mount(hosts: [HTMLElement, HTMLElement, HTMLElement]): Promise<void> {
    try {
      const yt = await loadYouTubeApi();
      if (this.#destroyed) return;
      const listener: DeckListener = {
        onState: (deck, state) => this.#onState(deck, state),
        onError: (deck, code, videoId) => this.#onError(deck, code, videoId),
      };
      this.#decks = hosts.map((host, index) => new Deck(index, host, yt, listener));
      this.#lastTick = performance.now();
      this.#timer = setInterval(() => this.#tick(), TICK_MS);
      this.#sync();
    } catch (error) {
      if (this.#destroyed) return;
      this.status = "unavailable";
      this.notice = error instanceof Error ? error.message : String(error);
    }
  }

  destroy(): void {
    this.#destroyed = true;
    this.#flushListen();
    if (this.#timer) clearInterval(this.#timer);
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    for (const deck of this.#decks) deck.destroy();
    this.#decks = [];
  }

  /** The release under judgement and the one after it. Safe to call on every change. */
  show(detail: ReleaseDetail | null, next: ReleaseDetail | null): void {
    this.#wanted = { detail, next };
    this.#sync();
  }

  pauseForResume(): void {
    this.#resumePaused = true;
    this.#activeDeck()?.pause();
  }

  /** Where the open release is playing, for a session checkpoint. */
  playbackPosition(): PlaybackPosition | null {
    if (!this.release || !this.entry) return null;
    const { track, video } = this.entry;
    const playback: PlaybackPosition = {
      releaseId: this.release.release.id,
      videoId: video.videoId,
      atSeconds: this.time,
    };
    if (track) playback.tune = tuneSnapshot(track);
    return playback;
  }

  /** Plays the saved moment when its release opens; null cancels one that is waiting. */
  restorePlayback(playback: PlaybackPosition | null): void {
    this.#pendingPlayback = playback;
  }

  /** The saved upload may no longer be on the release's playlist; it is added for this play. */
  #restorePlayback(): void {
    const playback = this.#pendingPlayback;
    const detail = this.release;
    if (!playback || !detail || playback.releaseId !== detail.release.id) return;
    this.#pendingPlayback = null;

    const entry = bookmarkedEntry(detail, playback);
    const index = this.entries.findIndex((other) => other.video.videoId === playback.videoId);
    if (index === -1) this.entries = [...this.entries, entry];
    else this.entries = this.entries.with(index, entry);
    this.playEntry(index === -1 ? this.entries.length - 1 : index, playback.atSeconds);
  }

  toggle(): void {
    this.#resumePaused = false;
    const deck = this.#activeDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.status === "no_audio") return;
    if (this.status === "playing") {
      deck.pause();
      return;
    }
    if (this.status === "ended") this.seekTo(deck.startOffset());
    deck.play();
  }

  /** While the Triage page is hidden, nothing starts playing on its own. */
  suspend(on: boolean): void {
    this.#suspended = on;
    if (!on) return;
    this.#activeDeck()?.pause();
    // Settings may switch the sandbox while the page is hidden; log what was heard until now.
    if (this.#listen) this.#restartListen();
  }

  nextTrack(): void {
    const next = nextEntry(this.entries, this.current, this.#playlistState(), { fallback: true });
    if (next === null) this.#notify("That was the last track. Judge it.");
    else this.playEntry(next);
  }

  previousTrack(): void {
    const previous = previousEntry(this.entries, this.current, this.#playlistState());
    if (previous === null) this.#notify("Already on the first track.");
    else this.playEntry(previous);
  }

  seekBy(seconds: number): void {
    const deck = this.#activeDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck)) return;
    const end = this.duration > 0 ? this.duration - 1 : Number.POSITIVE_INFINITY;
    this.seekTo(Math.max(0, Math.min(end, deck.currentTime() + seconds)));
  }

  jumpTo(fraction: number): void {
    const deck = this.#activeDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.duration <= 0) return;
    this.seekTo(this.duration * fraction);
    if (this.status !== "playing" && this.#canPlay()) deck.play();
  }

  /** A seek ends the listen at the deck's current time and starts a new one at the target. */
  seekTo(seconds: number): void {
    const deck = this.#activeDeck();
    if (!deck || !this.release || !this.entry) return;
    this.time = deck.currentTime();
    this.#flushListen();
    this.time = Math.max(0, seconds);
    deck.seekTo(this.time);
    this.#beginListen(this.release.release.id, this.entry);
  }

  /** Plays an entry from its start point, or from `atSeconds` for a saved moment. */
  playEntry(index: number, atSeconds?: number): void {
    const entry = this.entries[index];
    const release = this.release;
    if (!entry || !this.#activeDeck() || !release) return;
    this.#flushListen();
    this.current = index;
    this.played.add(entry.video.videoId);
    this.time = atSeconds ?? startSeconds(entry.video.durationSeconds, this.#fraction()) ?? 0;
    this.duration = entry.video.durationSeconds ?? 0;
    // The track deck buffered the entry at its start point, so a saved moment loads it afresh.
    const promoted = atSeconds === undefined && this.#promoteTrackDeck(entry, index);
    if (!promoted) this.#loadOnActiveDeck(entry, index, atSeconds);
    this.#beginListen(release.release.id, entry);
    this.#preloadTrack();
  }

  #loadOnActiveDeck(entry: PlaylistEntry, index: number, atSeconds?: number): void {
    const deck = this.#activeDeck();
    if (!deck || !this.release) return;
    deck.tag = { releaseId: this.release.release.id, entry: index };
    const mode = this.#canPlay() ? "play" : "cue";
    this.status = mode === "play" ? "loading" : this.#waitingStatus();
    this.#loadingSince = performance.now();
    void deck.load(entry.video, mode, { fraction: this.#fraction(), atSeconds });
  }

  /** Swaps in the deck that buffered this track, when it did; the old deck buffers the next one. */
  #promoteTrackDeck(entry: PlaylistEntry, index: number): boolean {
    const deck = this.#decks[this.#trackDeck];
    const tag = deck?.tag;
    if (!deck || !tag || tag.releaseId !== this.#openedId) return false;
    if (deck.videoId !== entry.video.videoId) return false;
    this.#activeDeck()?.park();
    this.#trackDeck = this.active;
    this.active = deck.id;
    deck.tag = { ...tag, entry: index };
    this.#startPreload(deck);
    return true;
  }

  /** Loads the track J would move to into the track deck, muted and paused at its start. */
  #preloadTrack(): void {
    const deck = this.#decks[this.#trackDeck];
    if (!deck) return;
    const release = this.release;
    const next =
      release && this.current !== null
        ? nextEntry(this.entries, this.current, this.#playlistState(), { fallback: true })
        : null;
    const entry = next === null ? undefined : this.entries[next];
    if (entry && this.#holdsOpenRelease(deck) && deck.videoId === entry.video.videoId) return;
    deck.park();
    if (!release || next === null || !entry) return;
    deck.tag = { releaseId: release.release.id, entry: next };
    void deck.load(entry.video, "preload", { fraction: this.#fraction() });
  }

  #canPlay(): boolean {
    return hasUserActivation() && !this.#suspended && !this.#resumePaused;
  }

  /** Status of a loaded video that is not allowed to start by itself. */
  #waitingStatus(): PlayerStatus {
    return hasUserActivation() ? "paused" : "needs_gesture";
  }

  #activeDeck(): Deck | undefined {
    return this.#decks[this.active];
  }

  #releaseDeckNow(): Deck | undefined {
    return this.#decks[this.#releaseDeck];
  }

  #playlistState(played: ReadonlySet<string> = this.played): PlaylistState {
    return { failed: this.failed, played, skipHeard: this.#skipHeard() };
  }

  #sync(): void {
    if (this.#decks.length === 0) return;
    const { detail, next } = this.#wanted;
    if ((detail?.release.id ?? null) !== this.#openedId) this.#openRelease(detail);
    else if (detail && this.release && videosChanged(this.release, detail))
      this.#refreshRelease(detail);
    this.#preload(next);
    this.#restorePlayback();
  }

  /** The open release gained a video (a pasted link): play it, keeping what was heard. */
  #refreshRelease(detail: ReleaseDetail): void {
    const heardBefore = new Map(
      this.entries.map((entry) => [entry.video.videoId, entry.heardBefore]),
    );
    const playing = this.entry?.video.videoId ?? null;
    this.release = detail;
    this.entries = buildPlaylist(detail, this.heardKeys).map((entry) => ({
      ...entry,
      heardBefore: heardBefore.get(entry.video.videoId) ?? entry.heardBefore,
    }));
    const added = this.entries.findIndex((entry) => !heardBefore.has(entry.video.videoId));
    if (added !== -1) {
      this.playEntry(added);
      return;
    }
    const index = this.entries.findIndex((entry) => entry.video.videoId === playing);
    this.current = index === -1 ? null : index;
    this.#preloadTrack();
  }

  #openRelease(detail: ReleaseDetail | null): void {
    this.#openedId = detail?.release.id ?? null;
    this.#flushListen();
    this.played.clear();
    this.heardNow.clear();
    this.notice = null;
    this.release = detail;
    this.time = 0;
    this.duration = 0;
    const active = this.#activeDeck();
    if (!detail || !active) {
      this.entries = [];
      this.current = null;
      active?.park();
      this.#preloadTrack();
      this.status = "idle";
      return;
    }
    const entries = buildPlaylist(detail, this.heardKeys);
    this.entries = entries;
    // #restorePlayback() starts the saved moment instead, once #sync() reaches it.
    if (this.#pendingPlayback?.releaseId === detail.release.id) return;
    const first = firstEntry(entries, this.#playlistState());
    if (this.#adoptPreload(detail, first)) return;
    if (first === null) {
      this.current = null;
      active.park();
      this.#preloadTrack();
      this.status = "no_audio";
      return;
    }
    this.playEntry(first);
  }

  #adoptPreload(detail: ReleaseDetail, first: number | null): boolean {
    const hidden = this.#releaseDeckNow();
    if (!hidden?.videoId || hidden.tag?.releaseId !== detail.release.id) return false;
    const index = this.entries.findIndex((entry) => entry.video.videoId === hidden.videoId);
    const entry = this.entries[index];
    // A tune heard after preloading can change the correct starting track.
    if (!entry || index !== first) return false;
    this.#activeDeck()?.park();
    this.#releaseDeck = this.active;
    this.active = hidden.id;
    this.nextReady = false;
    this.current = index;
    this.played.add(entry.video.videoId);
    this.duration = entry.video.durationSeconds ?? 0;
    this.time = startSeconds(entry.video.durationSeconds, this.#fraction()) ?? 0;
    this.#startPreload(hidden);
    this.#beginListen(detail.release.id, entry);
    this.#preloadTrack();
    return true;
  }

  #startPreload(deck: Deck): void {
    if (!this.#canPlay()) {
      this.status = this.#waitingStatus();
      return;
    }
    this.status = deck.state === PlayerState.PLAYING ? "playing" : "loading";
    this.#loadingSince = performance.now();
    deck.play();
  }

  /** Loads the next release's first video into the hidden deck, unless it already holds it. */
  #preload(next: ReleaseDetail | null): void {
    const hidden = this.#releaseDeckNow();
    if (!hidden) return;
    const entries = next ? buildPlaylist(next, this.heardKeys) : [];
    const first = firstEntry(entries, this.#playlistState(new Set()));
    const entry = first === null ? undefined : entries[first];
    if (next && entry && hidden.tag?.releaseId === next.release.id) {
      if (hidden.videoId === entry.video.videoId) return;
    }
    hidden.park();
    this.nextReady = false;
    if (!next || first === null || !entry) return;
    hidden.tag = { releaseId: next.release.id, entry: first };
    void hidden.load(entry.video, "preload", { fraction: this.#fraction() });
  }

  /** Events from a deck still holding a previous release (pausing, parking) must not leak. */
  #holdsOpenRelease(deck: Deck): boolean {
    return deck.tag !== null && deck.tag.releaseId === this.#openedId;
  }

  #onState(deck: Deck, state: number): void {
    if (this.#destroyed) return;
    if (deck.id !== this.active) {
      if (deck.id === this.#releaseDeck && deck.primed) this.nextReady = true;
      return;
    }
    if (!this.#holdsOpenRelease(deck)) return;
    switch (state) {
      case PlayerState.PLAYING:
        this.status = "playing";
        break;
      case PlayerState.PAUSED:
        if (this.status !== "needs_gesture") this.status = "paused";
        break;
      case PlayerState.BUFFERING:
        if (this.status !== "playing") this.status = "loading";
        break;
      case PlayerState.CUED:
        if (!hasUserActivation()) this.status = "needs_gesture";
        break;
      case PlayerState.ENDED:
        this.#advance();
        break;
    }
  }

  #onError(deck: Deck, code: number, videoId: string | null): void {
    if (this.#destroyed) return;
    const refused = videoId ?? deck.videoId;
    if (refused) this.failed.add(refused);
    // A late error for a video the deck has already left changes nothing on screen.
    if (refused !== deck.videoId) return;
    if (deck.id === this.#releaseDeck) {
      this.#preload(this.#wanted.next);
      return;
    }
    if (deck.id === this.#trackDeck) {
      this.#preloadTrack();
      return;
    }
    if (!this.#holdsOpenRelease(deck)) return;
    const entry = this.entry;
    this.#listen = null;
    const what = entry?.track ? `${entry.track.position} ${entry.track.title}` : "This video";
    this.#notify(`${what} won't play here: ${embedErrorReason(code)}. Skipped.`);
    const state = this.#playlistState();
    const next =
      nextEntry(this.entries, this.current, state, { fallback: true }) ??
      firstEntry(this.entries, state);
    if (next === null) {
      this.current = null;
      this.status = "no_audio";
      return;
    }
    this.playEntry(next);
  }

  #advance(): void {
    const next = nextEntry(this.entries, this.current, this.#playlistState(), { fallback: false });
    if (next === null) {
      this.#flushListen();
      this.status = "ended";
      return;
    }
    this.playEntry(next);
  }

  #tick(): void {
    const now = performance.now();
    const elapsedSeconds = Math.min(1, (now - this.#lastTick) / 1000);
    this.#lastTick = now;
    const deck = this.#activeDeck();
    if (!deck?.ready || !deck.videoId || !this.#holdsOpenRelease(deck)) return;
    if (this.status === "playing" || this.status === "paused") {
      this.time = deck.currentTime();
      const duration = deck.duration();
      if (duration > 0) this.duration = duration;
    }
    if (
      this.status === "loading" &&
      now - this.#loadingSince > BLOCKED_AFTER_MS &&
      (deck.state === PlayerState.UNSTARTED || deck.state === PlayerState.CUED)
    ) {
      this.status = "needs_gesture";
    }
    this.#countListen(elapsedSeconds);
  }

  #countListen(elapsedSeconds: number): void {
    const listen = this.#listen;
    if (this.status !== "playing" || !listen) return;
    // The first tick marks where sound began, which is after a load or seek finished.
    if (listen.seconds === 0) listen.context.startSeconds = Math.max(0, this.time - elapsedSeconds);
    listen.seconds += elapsedSeconds;
    if (listen.logged === 0 && listen.seconds >= LOG_AFTER_SECONDS) {
      this.#postListen(listen, { seconds: listen.seconds, heard: true });
      listen.logged = listen.seconds;
      if (listen.position) this.heardNow.add(listen.position);
      if (listen.heardKey) {
        this.heardKeys.add(listen.heardKey);
        this.#preload(this.#wanted.next);
      }
    }
  }

  #beginListen(releaseId: number, entry: PlaylistEntry): void {
    this.#listen = {
      client: this.#api.pinned(),
      context: this.#listenContext(entry),
      releaseId,
      position: entry.track?.position ?? null,
      heardKey: entry.track?.heardKey ?? null,
      videoId: entry.video.videoId,
      seconds: 0,
      logged: 0,
    };
  }

  #listenContext(entry: PlaylistEntry): ListenContext {
    return {
      playbackId: crypto.randomUUID(),
      sessionId: this.#sessionId,
      startedAt: new Date().toISOString(),
      startSeconds: this.time,
      endSeconds: this.time,
      videoTitle: entry.video.title,
      tune: entry.track ? tuneSnapshot(entry.track) : null,
    };
  }

  /** Logs the open entry's listen so far and starts a new one from here. */
  #restartListen(): void {
    this.#flushListen();
    if (this.release && this.entry) this.#beginListen(this.release.release.id, this.entry);
  }

  /**
   * Logs the playback since the last post when the listener leaves a track. A play shorter than
   * the threshold is logged too, but leaves the tune unheard (decision 38).
   */
  #flushListen(): void {
    const listen = this.#listen;
    this.#listen = null;
    if (!listen) return;
    if (listen.logged === 0) {
      if (listen.seconds >= SHORTEST_PLAY_SECONDS)
        this.#postListen(listen, { seconds: listen.seconds, heard: false });
      return;
    }
    if (listen.seconds - listen.logged < 1) return;
    this.#postListen(listen, { seconds: listen.seconds - listen.logged, heard: true });
  }

  #postListen(listen: Listen, play: { seconds: number; heard: boolean }): void {
    listen.client
      .postListenLog({
        releaseId: listen.releaseId,
        position: listen.position,
        videoId: listen.videoId,
        seconds: Math.round(play.seconds * 10) / 10,
        heard: play.heard,
        context: { ...listen.context, endSeconds: this.time },
      })
      .catch(() => {
        // Listening remains best effort; a missed sample must not interrupt digging.
      });
    listen.context.startSeconds = this.time;
  }

  #notify(message: string): void {
    this.notice = message;
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.notice = null;
    }, 5000);
  }
}

function videosChanged(before: ReleaseDetail, after: ReleaseDetail): boolean {
  const ids = (detail: ReleaseDetail) => detail.videos.map((video) => video.videoId).join(" ");
  return ids(before) !== ids(after);
}
