import { SvelteSet } from "svelte/reactivity";
import type { ReleaseDetail } from "../../shared/api.ts";
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
import type { Api } from "../api.ts";
import { bookmarkedEntry } from "./bookmark.ts";
import { ListenLog } from "./listen-log.ts";
import { Deck, type DeckListener } from "./deck.ts";
import type { PlayerStatus } from "./status.ts";
import { TimedMessage } from "../timed-message.svelte.ts";
import { embedErrorReason, loadYouTubeApi, PlayerState } from "./youtube.ts";

/** Why the open release's videos changed: a link pasted on it, or videos `P` found on Discogs. */
export type VideosChange = "attached" | "found";

const TICK_MS = 250;
/** How long a "play" load may sit unstarted before we assume the browser blocked sound. */
const BLOCKED_AFTER_MS = 3500;
/** YouTube lands a seek on a keyframe near the target, and reports the old time until it has. */
const SEEK_LANDED_SECONDS = 2;
/** A seek YouTube never reports, as past the end, stops holding the time after this long. */
const SEEK_HOLD_MS = 10_000;

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
  /** The release whose videos the visible deck plays. */
  detail = $state.raw<ReleaseDetail | null>(null);
  entries = $state.raw<PlaylistEntry[]>([]);
  /** The index of the playing entry in `entries`. */
  entryIndex = $state<number | null>(null);
  time = $state(0);
  duration = $state(0);
  /** Where the listener seeked to, shown until the player reports the new time. */
  #seek = $state<{ seconds: number; since: number } | null>(null);
  /** Short message about the player, such as a video that would not embed. */
  #notice = new TimedMessage(5000);
  /** The first video of the next release is buffered. */
  nextReady = $state(false);
  /** Index of the visible deck, which plays the open release. */
  visibleDeckIndex = $state(0);
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

  #startAtFraction: () => number;
  #skipHeard: () => boolean;
  #decks: Deck[] = [];
  /** Index of the hidden deck that buffers the next release's first video. */
  #nextReleaseDeckIndex = 1;
  /** Index of the hidden deck that buffers the track J moves to on the open release. */
  #nextTrackDeckIndex = 2;
  /** What show() last asked for: the release under judgement, the next one, and why. */
  #shown: { detail: ReleaseDetail | null; next: ReleaseDetail | null; change: VideosChange } = {
    detail: null,
    next: null,
    change: "found",
  };
  /** Release the decks were last pointed at; undefined before the first one. */
  #openReleaseId: number | null | undefined = undefined;
  #listens: ListenLog;
  /** A saved moment to play once its release opens, from Twelves or a resumed session. */
  #pendingPlayback: PlaybackPosition | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastTick = 0;
  #loadingSince = 0;
  #destroyed = false;
  /** The Triage page is hidden: load and cue, but never start sound. */
  #suspended = false;
  /** A session is being resumed: nothing starts until the listener presses play. */
  #resumePaused = false;
  /** The open video waits at its start point, neither played nor moved: a new one may replace it. */
  #atStartPoint = false;

  constructor(api: Api, settings: PlayerSettings) {
    this.#listens = new ListenLog(api);
    this.#startAtFraction = settings.startAtFraction;
    this.#skipHeard = settings.skipHeard ?? (() => true);
  }

  get notice(): string | null {
    return this.#notice.text;
  }

  get sessionId(): string | null {
    return this.#listens.sessionId;
  }

  /** A new session id applies from the next listen; the playback so far is logged under the old one. */
  set sessionId(id: string | null) {
    if (id === this.#listens.sessionId) return;
    this.#listens.flush(this.time);
    this.#listens.sessionId = id;
    this.#beginListenOnEntry();
  }

  /** A seek or jump is on its way: the time shown is its target, and YouTube may be buffering. */
  get seeking(): boolean {
    return this.#seek !== null;
  }

  get entry(): PlaylistEntry | null {
    return this.entryIndex === null ? null : (this.entries[this.entryIndex] ?? null);
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
      this.#notice.hold(error instanceof Error ? error.message : String(error));
    }
  }

  destroy(): void {
    this.#destroyed = true;
    this.#flushListen();
    if (this.#timer) clearInterval(this.#timer);
    this.#notice.destroy();
    for (const deck of this.#decks) deck.destroy();
    this.#decks = [];
  }

  /**
   * The release under judgement, the one after it, and why the open release's videos last
   * changed. Safe to call on every change.
   */
  show(detail: ReleaseDetail | null, next: ReleaseDetail | null, change: VideosChange): void {
    this.#shown = { detail, next, change };
    this.#sync();
  }

  pauseForResume(): void {
    this.#resumePaused = true;
    this.#visibleDeck()?.pause();
  }

  /** Where the open release is playing, for a session checkpoint. */
  playbackPosition(): PlaybackPosition | null {
    if (!this.detail || !this.entry) return null;
    const { track, video } = this.entry;
    const playback: PlaybackPosition = {
      releaseId: this.detail.release.id,
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
    const detail = this.detail;
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
    const deck = this.#visibleDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.status === "no_audio") return;
    if (this.status === "playing") {
      deck.pause();
      return;
    }
    if (this.status === "ended") this.seekTo(deck.startOffset());
    deck.play();
  }

  /**
   * Settings moved the start point. The buffered decks load again at it, and the open video cues
   * again while it waits at the old one; a video that played or was moved keeps its place.
   */
  moveStartPoint(): void {
    if (this.#decks.length === 0) return;
    this.#nextReleaseDeck()?.park();
    this.#decks[this.#nextTrackDeckIndex]?.park();
    if (this.entryIndex !== null && this.#atStartPoint) this.playEntry(this.entryIndex);
    else this.#preloadTrack();
    this.#preload(this.#shown.next);
  }

  /** While the Triage page is hidden, nothing starts playing on its own. */
  suspend(on: boolean): void {
    this.#suspended = on;
    if (!on) return;
    this.#visibleDeck()?.pause();
    // The page may stay hidden until it closes; log what was heard until now.
    if (this.#listens.active) {
      this.#listens.flush(this.time);
      this.#beginListenOnEntry();
    }
  }

  nextTrack(): void {
    const next = nextEntry(this.entries, this.entryIndex, this.#playlistState(), {
      fallback: true,
    });
    if (next === null) this.#notice.show("That was the last track. Your verdict?");
    else this.playEntry(next);
  }

  previousTrack(): void {
    const previous = previousEntry(this.entries, this.entryIndex, this.#playlistState());
    if (previous === null) this.#notice.show("Already on the first track.");
    else this.playEntry(previous);
  }

  seekBy(seconds: number): void {
    const deck = this.#visibleDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck)) return;
    const end = this.duration > 0 ? this.duration - 1 : Number.POSITIVE_INFINITY;
    // Arrows pressed in a row step from the last target, which YouTube may not have reached.
    const from = this.#seek?.seconds ?? deck.currentTime();
    this.seekTo(Math.max(0, Math.min(end, from + seconds)));
  }

  /** Seeks to a fraction of the video; a paused video stays paused there, as after an arrow. */
  jumpTo(fraction: number): void {
    const deck = this.#visibleDeck();
    if (!deck?.videoId || !this.#holdsOpenRelease(deck) || this.duration <= 0) return;
    this.seekTo(this.duration * fraction);
  }

  /** A seek ends the listen at the deck's current time and starts a new one at the target. */
  seekTo(seconds: number): void {
    const deck = this.#visibleDeck();
    if (!deck || !this.detail || !this.entry) return;
    this.time = deck.currentTime();
    this.#flushListen();
    this.time = Math.max(0, seconds);
    this.#seek = { seconds: this.time, since: performance.now() };
    this.#atStartPoint = false;
    deck.seekTo(this.time);
    this.#beginListen(this.detail.release.id, this.entry);
  }

  /** Plays an entry from its start point, or from `atSeconds` for a saved moment. */
  playEntry(index: number, atSeconds?: number): void {
    const entry = this.entries[index];
    const detail = this.detail;
    if (!entry || !this.#visibleDeck() || !detail) return;
    this.#flushListen();
    this.entryIndex = index;
    this.played.add(entry.video.videoId);
    this.#seek = null;
    this.time =
      atSeconds ?? startSeconds(entry.video.durationSeconds, this.#startAtFraction()) ?? 0;
    this.#atStartPoint = atSeconds === undefined;
    this.duration = entry.video.durationSeconds ?? 0;
    // The track deck buffered the entry at its start point, so a saved moment loads it afresh.
    const promoted = atSeconds === undefined && this.#promoteTrackDeck(entry, index);
    if (!promoted) this.#loadOnVisibleDeck(entry, index, atSeconds);
    this.#beginListen(detail.release.id, entry);
    this.#preloadTrack();
  }

  #loadOnVisibleDeck(entry: PlaylistEntry, index: number, atSeconds?: number): void {
    const deck = this.#visibleDeck();
    if (!deck || !this.detail) return;
    deck.tag = { releaseId: this.detail.release.id, entry: index };
    const mode = this.#canPlay() ? "play" : "cue";
    this.status = mode === "play" ? "loading" : this.#waitingStatus();
    this.#loadingSince = performance.now();
    void deck.load(entry.video, mode, { fraction: this.#startAtFraction(), atSeconds });
  }

  /** Swaps in the deck that buffered this track, when it did; the old deck buffers the next one. */
  #promoteTrackDeck(entry: PlaylistEntry, index: number): boolean {
    const deck = this.#decks[this.#nextTrackDeckIndex];
    const tag = deck?.tag;
    if (!deck || !tag || tag.releaseId !== this.#openReleaseId) return false;
    if (deck.videoId !== entry.video.videoId) return false;
    this.#visibleDeck()?.park();
    this.#nextTrackDeckIndex = this.visibleDeckIndex;
    this.visibleDeckIndex = deck.id;
    deck.tag = { ...tag, entry: index };
    this.#startPreload(deck);
    return true;
  }

  /** Loads the track J would move to into the track deck, muted and paused at its start. */
  #preloadTrack(): void {
    const deck = this.#decks[this.#nextTrackDeckIndex];
    if (!deck) return;
    const detail = this.detail;
    const next =
      detail && this.entryIndex !== null
        ? nextEntry(this.entries, this.entryIndex, this.#playlistState(), { fallback: true })
        : null;
    const entry = next === null ? undefined : this.entries[next];
    if (entry && this.#holdsOpenRelease(deck) && deck.videoId === entry.video.videoId) return;
    deck.park();
    if (!detail || next === null || !entry) return;
    deck.tag = { releaseId: detail.release.id, entry: next };
    void deck.load(entry.video, "preload", { fraction: this.#startAtFraction() });
  }

  #canPlay(): boolean {
    return hasUserActivation() && !this.#suspended && !this.#resumePaused;
  }

  /** Status of a loaded video that is not allowed to start by itself. */
  #waitingStatus(): PlayerStatus {
    return hasUserActivation() ? "paused" : "needs_gesture";
  }

  #visibleDeck(): Deck | undefined {
    return this.#decks[this.visibleDeckIndex];
  }

  #nextReleaseDeck(): Deck | undefined {
    return this.#decks[this.#nextReleaseDeckIndex];
  }

  #playlistState(played: ReadonlySet<string> = this.played): PlaylistState {
    return { failed: this.failed, played, skipHeard: this.#skipHeard() };
  }

  #sync(): void {
    if (this.#decks.length === 0) return;
    const { detail, next, change } = this.#shown;
    if ((detail?.release.id ?? null) !== this.#openReleaseId) this.#openRelease(detail);
    else if (detail && this.detail && videosChanged(this.detail, detail))
      this.#refreshRelease(detail, change);
    this.#preload(next);
    this.#restorePlayback();
  }

  /**
   * The open release gained videos, keeping what was heard. A pasted link plays at once, as does a
   * video P found for a record that had nothing playable; otherwise P's videos join the tracklist
   * and the player goes on as it was, playing or waiting for Space.
   */
  #refreshRelease(detail: ReleaseDetail, change: VideosChange): void {
    const heardBefore = new Map(
      this.entries.map((entry) => [entry.video.videoId, entry.heardBefore]),
    );
    const playing = this.entry?.video.videoId ?? null;
    const playsAdded = change === "attached" || this.status === "no_audio";
    this.detail = detail;
    this.entries = buildPlaylist(detail, this.heardKeys).map((entry) => ({
      ...entry,
      heardBefore: heardBefore.get(entry.video.videoId) ?? entry.heardBefore,
    }));
    const added = this.entries.findIndex((entry) => !heardBefore.has(entry.video.videoId));
    if (added !== -1 && playsAdded) {
      this.playEntry(added);
      return;
    }
    const index = this.entries.findIndex((entry) => entry.video.videoId === playing);
    if (index === -1) {
      this.#replaceMissingVideo();
      return;
    }
    this.entryIndex = index;
    const deck = this.#visibleDeck();
    if (deck?.tag) deck.tag = { ...deck.tag, entry: index };
    this.#preloadTrack();
  }

  #replaceMissingVideo(): void {
    this.#flushListen();
    this.#visibleDeck()?.park();
    this.entryIndex = null;
    this.time = 0;
    this.duration = 0;
    const first = firstEntry(this.entries, this.#playlistState());
    if (first === null) {
      this.status = "no_audio";
      this.#preloadTrack();
      return;
    }
    // A metadata refresh must not start sound the listener had paused.
    if (this.status === "paused") this.#resumePaused = true;
    this.playEntry(first);
  }

  #openRelease(detail: ReleaseDetail | null): void {
    this.#openReleaseId = detail?.release.id ?? null;
    this.#flushListen();
    this.played.clear();
    this.heardNow.clear();
    this.#notice.clear();
    this.detail = detail;
    this.#seek = null;
    this.time = 0;
    this.duration = 0;
    const active = this.#visibleDeck();
    if (!detail || !active) {
      this.entries = [];
      this.entryIndex = null;
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
      this.entryIndex = null;
      active.park();
      this.#preloadTrack();
      this.status = "no_audio";
      return;
    }
    this.playEntry(first);
  }

  #adoptPreload(detail: ReleaseDetail, first: number | null): boolean {
    const hidden = this.#nextReleaseDeck();
    if (!hidden?.videoId || hidden.tag?.releaseId !== detail.release.id) return false;
    const index = this.entries.findIndex((entry) => entry.video.videoId === hidden.videoId);
    const entry = this.entries[index];
    // A tune heard after preloading can change the correct starting track.
    if (!entry || index !== first) return false;
    this.#visibleDeck()?.park();
    this.#nextReleaseDeckIndex = this.visibleDeckIndex;
    this.visibleDeckIndex = hidden.id;
    this.nextReady = false;
    this.entryIndex = index;
    this.played.add(entry.video.videoId);
    this.#seek = null;
    this.duration = entry.video.durationSeconds ?? 0;
    this.time = startSeconds(entry.video.durationSeconds, this.#startAtFraction()) ?? 0;
    this.#atStartPoint = true;
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
    const hidden = this.#nextReleaseDeck();
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
    void hidden.load(entry.video, "preload", { fraction: this.#startAtFraction() });
  }

  /** Events from a deck still holding a previous release (pausing, parking) must not leak. */
  #holdsOpenRelease(deck: Deck): boolean {
    return deck.tag !== null && deck.tag.releaseId === this.#openReleaseId;
  }

  #onState(deck: Deck, state: number): void {
    if (this.#destroyed) return;
    if (deck.id !== this.visibleDeckIndex) {
      if (deck.id === this.#nextReleaseDeckIndex && deck.primed) this.nextReady = true;
      return;
    }
    if (!this.#holdsOpenRelease(deck)) return;
    switch (state) {
      case PlayerState.PLAYING:
        this.status = "playing";
        this.#atStartPoint = false;
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
    if (deck.id === this.#nextReleaseDeckIndex) {
      this.#preload(this.#shown.next);
      return;
    }
    if (deck.id === this.#nextTrackDeckIndex) {
      this.#preloadTrack();
      return;
    }
    if (!this.#holdsOpenRelease(deck)) return;
    const entry = this.entry;
    this.#listens.drop();
    const what = entry?.track ? `${entry.track.position} ${entry.track.title}` : "This video";
    this.#notice.show(`${what} won't play here: ${embedErrorReason(code)}. Skipped.`);
    const state = this.#playlistState();
    const next =
      nextEntry(this.entries, this.entryIndex, state, { fallback: true }) ??
      firstEntry(this.entries, state);
    if (next === null) {
      this.entryIndex = null;
      this.status = "no_audio";
      return;
    }
    this.playEntry(next);
  }

  #advance(): void {
    const next = nextEntry(this.entries, this.entryIndex, this.#playlistState(), {
      fallback: false,
    });
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
    const deck = this.#visibleDeck();
    if (!deck?.ready || !deck.videoId || !this.#holdsOpenRelease(deck)) return;
    if (this.status === "playing" || this.status === "paused") {
      this.time = this.#reportedTime(deck, now);
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
    if (deck.state === PlayerState.PLAYING) this.#countListen(elapsedSeconds);
  }

  /** The deck's time, or the seek target while the deck still reports the time before the seek. */
  #reportedTime(deck: Deck, now: number): number {
    const reported = deck.currentTime();
    const seek = this.#seek;
    if (!seek) return reported;
    const landed = Math.abs(reported - seek.seconds) < SEEK_LANDED_SECONDS;
    if (!landed && now - seek.since < SEEK_HOLD_MS) return seek.seconds;
    this.#seek = null;
    return reported;
  }

  #countListen(elapsedSeconds: number): void {
    if (this.status !== "playing") return;
    const heard = this.#listens.count(elapsedSeconds, this.time);
    if (!heard) return;
    if (heard.position) this.heardNow.add(heard.position);
    if (!heard.heardKey) return;
    this.heardKeys.add(heard.heardKey);
    this.#preload(this.#shown.next);
  }

  #beginListen(releaseId: number, entry: PlaylistEntry): void {
    this.#listens.begin(releaseId, entry, this.time);
  }

  /** Starts counting the open entry's play from here, as after logging what came before. */
  #beginListenOnEntry(): void {
    if (this.detail && this.entry) this.#beginListen(this.detail.release.id, this.entry);
  }

  #flushListen(): void {
    this.#listens.flush(this.time);
  }
}

function videosChanged(before: ReleaseDetail, after: ReleaseDetail): boolean {
  const ids = (detail: ReleaseDetail) => detail.videos.map((video) => video.videoId).join(" ");
  return ids(before) !== ids(after);
}
