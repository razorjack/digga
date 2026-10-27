import type { ListenContext } from "../../shared/api.ts";
import type { PlaylistEntry } from "../../shared/playlist.ts";
import { tuneSnapshot } from "../../shared/track-identity.ts";
import type { Api } from "../api.ts";

/** A play turns the tune heard after this many seconds; a shorter one is logged as not heard. */
const LOG_AFTER_SECONDS = 4;
/** The log keeps seconds to a tenth; a play that rounds to nothing is not logged. */
const SHORTEST_PLAY_SECONDS = 0.05;

interface Listen {
  /** Saved with each post; `startSeconds` moves to where the next post's playback starts. */
  context: ListenContext;
  releaseId: number;
  position: string | null;
  heardKey: string | null;
  videoId: string;
  /** Seconds played so far. */
  seconds: number;
  /** Seconds already posted as heard; 0 until the play passed the threshold. */
  logged: number;
}

/** The track a play just made heard. */
export interface HeardTrack {
  position: string | null;
  heardKey: string | null;
}

/**
 * Logs how long each entry plays, to the listen log. A play is posted once it passes the
 * threshold, which makes its tune heard, and again for the time after that when it ends.
 */
export class ListenLog {
  /** The digging session listens are logged under; see SessionCheckpoint. */
  sessionId: string | null = null;
  #api: Pick<Api, "postListenLog">;
  #listen: Listen | null = null;

  constructor(api: Pick<Api, "postListenLog">) {
    this.#api = api;
  }

  /** A play is being counted. */
  get active(): boolean {
    return this.#listen !== null;
  }

  /** Starts counting the entry's play from `atSeconds` into its video. */
  begin(releaseId: number, entry: PlaylistEntry, atSeconds: number): void {
    this.#listen = {
      context: this.#context(entry, atSeconds),
      releaseId,
      position: entry.track?.position ?? null,
      heardKey: entry.track?.heardKey ?? null,
      videoId: entry.video.videoId,
      seconds: 0,
      logged: 0,
    };
  }

  /**
   * Counts a tick of sound that ended at `atSeconds`. Returns the track when this tick made it
   * heard, else null.
   */
  count(elapsedSeconds: number, atSeconds: number): HeardTrack | null {
    const listen = this.#listen;
    if (!listen) return null;
    // The first tick marks where sound began, which is after a load or seek finished.
    if (listen.seconds === 0) listen.context.startSeconds = Math.max(0, atSeconds - elapsedSeconds);
    listen.seconds += elapsedSeconds;
    if (listen.logged > 0 || listen.seconds < LOG_AFTER_SECONDS) return null;
    this.#post(listen, { seconds: listen.seconds, heard: true }, atSeconds);
    listen.logged = listen.seconds;
    return { position: listen.position, heardKey: listen.heardKey };
  }

  /**
   * Logs the play since the last post, ending at `atSeconds`, and stops counting. A play shorter
   * than the threshold is logged too, but leaves the tune unheard (decision 38).
   */
  flush(atSeconds: number): void {
    const listen = this.#listen;
    this.#listen = null;
    if (!listen) return;
    if (listen.logged === 0) {
      if (listen.seconds >= SHORTEST_PLAY_SECONDS)
        this.#post(listen, { seconds: listen.seconds, heard: false }, atSeconds);
      return;
    }
    if (listen.seconds - listen.logged < 1) return;
    this.#post(listen, { seconds: listen.seconds - listen.logged, heard: true }, atSeconds);
  }

  /** Stops counting without logging, as for a video that would not play. */
  drop(): void {
    this.#listen = null;
  }

  #context(entry: PlaylistEntry, atSeconds: number): ListenContext {
    return {
      playbackId: crypto.randomUUID(),
      sessionId: this.sessionId,
      startedAt: new Date().toISOString(),
      startSeconds: atSeconds,
      endSeconds: atSeconds,
      videoTitle: entry.video.title,
      tune: entry.track ? tuneSnapshot(entry.track) : null,
    };
  }

  #post(listen: Listen, play: { seconds: number; heard: boolean }, atSeconds: number): void {
    this.#api
      .postListenLog({
        releaseId: listen.releaseId,
        position: listen.position,
        videoId: listen.videoId,
        seconds: Math.round(play.seconds * 10) / 10,
        heard: play.heard,
        context: { ...listen.context, endSeconds: atSeconds },
      })
      .catch(() => {
        // Listening remains best effort; a missed sample must not interrupt digging.
      });
    listen.context.startSeconds = atSeconds;
  }
}
