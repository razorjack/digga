import type { Config } from "../../shared/config.ts";
import type {
  SavedSession,
  SessionInput,
  SessionResolution,
} from "../../shared/digging-session.ts";
import type { AppApi } from "../api.ts";
import type { TriagePlayer } from "../player/triage-player.svelte.ts";
import { errorMessage } from "../stores.svelte.ts";
import type { TriageSession } from "./session.svelte.ts";

const AUTOSAVE_MS = 5000;

interface SettingsAccess {
  value: Config | null;
  save(config: Config): Promise<unknown>;
}

type SessionStateAccess = Pick<TriageSession, "status" | "checkpoint" | "restoreSession">;
type PlayerStateAccess = Pick<
  TriagePlayer,
  "sessionId" | "playbackPosition" | "restorePlayback" | "pauseForResume"
>;
type SessionIdentity = Pick<SessionInput, "id" | "startedAt">;

/**
 * Saves where the Triage session is, so a later visit can resume there, and offers to resume the
 * latest saved session. Only live mode saves; the sandbox has no sessions.
 */
export class SessionCheckpoint {
  /** The saved session the page offers to resume, until the listener chooses. */
  pending = $state.raw<SavedSession | null>(null);
  restoring = $state(false);
  /** How the last save or resume went, for the page's status line. */
  message = $state("");

  #api: AppApi;
  #session: SessionStateAccess;
  #player: PlayerStateAccess;
  #settings: SettingsAccess;
  /** The session being saved; null until the listener resumes one or starts fresh. */
  #identity: SessionIdentity | null = null;
  /** Bumped by open(), startFresh() and destroy(); an answer meant for an older one is dropped. */
  #generation = 0;
  /** The api generation open() last ran in; saves stop when the mode changes. */
  #modeGeneration = -1;
  #saving = false;
  /** The state last saved, serialized, so an unchanged session is not saved again. */
  #lastState = "";

  constructor(
    api: AppApi,
    session: SessionStateAccess,
    player: PlayerStateAccess,
    settings: SettingsAccess,
  ) {
    this.#api = api;
    this.#session = session;
    this.#player = player;
    this.#settings = settings;
  }

  /** Saves every few seconds and when the page is hidden. The cleanup saves once more. */
  autosave(): () => void {
    const save = () => void this.save();
    const timer = setInterval(save, AUTOSAVE_MS);
    document.addEventListener("visibilitychange", save);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", save);
      save();
    };
  }

  /**
   * Runs after each queue (re)start. The first start in an api mode offers the latest saved
   * session; a restart after a settings change in the same mode starts a new session.
   */
  async open(): Promise<void> {
    const sameMode = this.#modeGeneration === this.#api.generation;
    this.#modeGeneration = this.#api.generation;
    const generation = this.#reset();
    if (this.#api.mode === "sandbox") return;
    if (sameMode) {
      this.startFresh();
      return;
    }

    try {
      const saved = await this.#api.pinned().getLatestSession();
      if (generation !== this.#generation) return;
      this.pending = saved;
      if (!saved) this.startFresh();
    } catch (error) {
      if (generation === this.#generation)
        this.message = `Could not read the last session: ${errorMessage(error)}`;
    }
  }

  startFresh(): void {
    this.#generation += 1;
    this.#continueSession({ id: crypto.randomUUID(), startedAt: new Date().toISOString() });
    this.message = "";
  }

  async save(): Promise<void> {
    const identity = this.#identity;
    if (!identity || !this.#canSave()) return;
    const state = this.#session.checkpoint(this.#player.playbackPosition());
    const serialized = JSON.stringify(state);
    if (serialized === this.#lastState) return;

    const generation = this.#generation;
    const client = this.#api.pinned();
    this.#saving = true;
    try {
      await client.putSession({ ...identity, state });
      if (generation !== this.#generation) return;
      this.#lastState = serialized;
      this.message = "Session position saved.";
    } catch (error) {
      if (generation === this.#generation)
        this.message = `Session position not saved: ${errorMessage(error)}`;
    } finally {
      this.#saving = false;
    }
  }

  /** Resumes the offered session: its settings, queue position, round and playback position. */
  async resume(): Promise<void> {
    const saved = this.pending;
    const config = this.#settings.value;
    if (!saved || !config || this.restoring) return;
    const generation = this.#generation;
    const isCurrent = () =>
      generation === this.#generation && this.#api.generation === this.#modeGeneration;
    const client = this.#api.pinned();
    this.restoring = true;
    this.#player.pauseForResume();

    try {
      const resolved = await client.resolveSession(saved.id);
      if (!isCurrent()) return;
      await this.#settings.save(withSessionSettings(config, saved));
      if (!isCurrent()) return;
      this.#restorePlayback(resolved);
      await this.#session.restoreSession(resolved);
      if (!isCurrent()) return;
      this.#continueSession(saved);
      this.message = resumedMessage(resolved.unavailable);
    } catch (error) {
      if (generation === this.#generation)
        this.message = `Could not resume the session: ${errorMessage(error)}`;
    } finally {
      if (generation === this.#generation) this.restoring = false;
    }
  }

  destroy(): void {
    this.#generation += 1;
    this.#identity = null;
  }

  /** Forgets the session and any offer; returns the new generation. */
  #reset(): number {
    this.#identity = null;
    this.pending = null;
    this.restoring = false;
    this.message = "";
    this.#player.sessionId = null;
    this.#player.restorePlayback(null);
    return ++this.#generation;
  }

  /** Saves and listens from now on belong to this session. */
  #continueSession(session: SessionIdentity): void {
    this.#identity = { id: session.id, startedAt: session.startedAt };
    this.#lastState = "";
    this.pending = null;
    this.#player.sessionId = session.id;
  }

  /** A chosen session in live mode, with the queue ready and no other save or resume running. */
  #canSave(): boolean {
    if (this.pending || this.restoring || this.#saving) return false;
    if (this.#session.status !== "ready") return false;
    return this.#api.mode === "live" && this.#api.generation === this.#modeGeneration;
  }

  /** The saved playback position applies only when its record is the first one resumed. */
  #restorePlayback(resolved: SessionResolution): void {
    const firstId = resolved.round?.[0]?.release?.id ?? resolved.current?.id;
    const playback = resolved.session.state.playback;
    this.#player.restorePlayback(playback?.releaseId === firstId ? playback : null);
  }
}

function withSessionSettings(config: Config, saved: SavedSession): Config {
  const { filters, queue, player } = saved.config;
  return { ...config, filters, queue, player };
}

function resumedMessage(unavailable: number): string {
  if (unavailable === 0) return "Session resumed. Press Space to listen.";
  return `Session resumed. ${unavailable} saved records are now decided, filtered out, or missing. Press Space to listen.`;
}
