import { SvelteSet } from "svelte/reactivity";
import type { ReleaseDetail } from "../../shared/api.ts";
import {
  buildPlaylist,
  firstEntry,
  nextEntry,
  type PlaylistEntry,
  previousEntry,
  startSeconds,
} from "../../shared/playlist.ts";
import type { Api, AppApi } from "../api.ts";
import { Deck, type DeckListener } from "./deck.ts";
import type { PlayerStatus } from "./status.ts";
import { embedErrorReason, loadYouTubeApi, PlayerState } from "./youtube.ts";

/** A listen counts (and the tune turns heard) after this many seconds of playback. */
const LOG_AFTER_SECONDS = 4;
const TICK_MS = 250;
/** How long a "play" load may sit unstarted before we assume the browser blocked sound. */
const BLOCKED_AFTER_MS = 3500;

interface Listen {
  /** The api of the mode the tune was heard in; a sandbox listen never reaches the server. */
  client: Api;
  releaseId: number;
  position: string | null;
  heardKey: string | null;
  videoId: string;
  seconds: number;
  logged: number;
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
  #timer: ReturnType<typeof setInterval> | null = null;
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;
  #lastTick = 0;
  #loadingSince = 0;
  #destroyed = false;
  /** The Triage page is hidden: load and cue, but never start sound. */
  #suspended = false;

  constructor(api: AppApi, startAtFraction: () => number) {
    this.#api = api;
    this.#fraction = startAtFraction;
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

  toggle(): void {
    const deck = this.#activeDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.status === "no_audio") return;
    if (this.status === "playing") {
      deck.pause();
      return;
    }
    if (this.status === "ended") deck.seekTo(deck.startOffset());
    deck.play();
  }

  /** While the Triage page is hidden, nothing starts playing on its own. */
  suspend(on: boolean): void {
    this.#suspended = on;
    if (!on) return;
    this.#activeDeck()?.pause();
    // Settings may switch the sandbox while the page is hidden; log what was heard until now.
    if (this.#listen) {
      this.#flushListen();
      if (this.release && this.entry) this.#beginListen(this.release.release.id, this.entry);
    }
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
    deck.seekTo(Math.min(end, deck.currentTime() + seconds));
    this.time = deck.currentTime();
  }

  jumpTo(fraction: number): void {
    const deck = this.#activeDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.duration <= 0) return;
    deck.seekTo(this.duration * fraction);
    if (this.status !== "playing" && this.#canPlay()) deck.play();
  }

  playEntry(index: number): void {
    const entry = this.entries[index];
    const release = this.release;
    if (!entry || !this.#activeDeck() || !release) return;
    this.#flushListen();
    this.current = index;
    this.played.add(entry.video.videoId);
    this.time = startSeconds(entry.video.durationSeconds, this.#fraction()) ?? 0;
    this.duration = entry.video.durationSeconds ?? 0;
    if (!this.#promoteTrackDeck(entry, index)) this.#loadOnActiveDeck(entry, index);
    this.#beginListen(release.release.id, entry);
    this.#preloadTrack();
  }

  #loadOnActiveDeck(entry: PlaylistEntry, index: number): void {
    const deck = this.#activeDeck();
    if (!deck || !this.release) return;
    deck.tag = { releaseId: this.release.release.id, entry: index };
    const mode = this.#canPlay() ? "play" : "cue";
    this.status = mode === "play" ? "loading" : this.#waitingStatus();
    this.#loadingSince = performance.now();
    void deck.load(entry.video.videoId, entry.video.durationSeconds, this.#fraction(), mode);
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
    void deck.load(entry.video.videoId, entry.video.durationSeconds, this.#fraction(), "preload");
  }

  #canPlay(): boolean {
    return hasUserActivation() && !this.#suspended;
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

  #playlistState() {
    return { failed: this.failed, played: this.played };
  }

  #sync(): void {
    if (this.#decks.length === 0) return;
    const { detail, next } = this.#wanted;
    if ((detail?.release.id ?? null) !== this.#openedId) this.#openRelease(detail);
    else if (detail && this.release && videosChanged(this.release, detail))
      this.#refreshRelease(detail);
    this.#preload(next);
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
    const first = firstEntry(entries, { failed: this.failed, played: new Set() });
    const entry = first === null ? undefined : entries[first];
    if (next && entry && hidden.tag?.releaseId === next.release.id) {
      if (hidden.videoId === entry.video.videoId) return;
    }
    hidden.park();
    this.nextReady = false;
    if (!next || first === null || !entry) return;
    hidden.tag = { releaseId: next.release.id, entry: first };
    void hidden.load(entry.video.videoId, entry.video.durationSeconds, this.#fraction(), "preload");
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
    listen.seconds += elapsedSeconds;
    if (listen.logged === 0 && listen.seconds >= LOG_AFTER_SECONDS) {
      this.#postListen(listen, listen.seconds);
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
      releaseId,
      position: entry.track?.position ?? null,
      heardKey: entry.track?.heardKey ?? null,
      videoId: entry.video.videoId,
      seconds: 0,
      logged: 0,
    };
  }

  /** Logs the playback since the last post when the listener leaves a track. */
  #flushListen(): void {
    const listen = this.#listen;
    this.#listen = null;
    // A tap shorter than the logging threshold is not a listen (decision 38).
    if (!listen || listen.logged === 0 || listen.seconds - listen.logged < 1) return;
    this.#postListen(listen, listen.seconds - listen.logged);
  }

  #postListen(listen: Listen, seconds: number): void {
    listen.client
      .postListenLog({
        releaseId: listen.releaseId,
        position: listen.position,
        videoId: listen.videoId,
        seconds: Math.round(seconds * 10) / 10,
      })
      .catch(() => {
        // A lost listen only affects greying; the next listen of the tune logs it again.
      });
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
