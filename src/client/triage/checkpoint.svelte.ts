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

interface SettingsAccess {
  value: Config | null;
  save(config: Config): Promise<unknown>;
}

type SessionStateAccess = Pick<TriageSession, "status" | "checkpoint" | "restoreSession">;
type PlayerStateAccess = Pick<
  TriagePlayer,
  "sessionId" | "playbackPosition" | "restorePlayback" | "pauseForResume"
>;

export class SessionCheckpoint {
  pending = $state.raw<SavedSession | null>(null);
  restoring = $state(false);
  message = $state("");
  #api: AppApi;
  #session: SessionStateAccess;
  #player: PlayerStateAccess;
  #settings: SettingsAccess;
  #identity: Pick<SessionInput, "id" | "startedAt"> | null = null;
  #generation = 0;
  #modeGeneration = -1;
  #saving = false;
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

  async open(): Promise<void> {
    const sameMode = this.#modeGeneration === this.#api.generation;
    this.#modeGeneration = this.#api.generation;
    const generation = ++this.#generation;
    this.#identity = null;
    this.restoring = false;
    this.#player.sessionId = null;
    this.#player.restorePlayback(null);
    this.pending = null;
    this.message = "";
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
    this.#identity = { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
    this.#lastState = "";
    this.pending = null;
    this.#player.sessionId = this.#identity.id;
    this.message = "";
  }

  async save(): Promise<void> {
    if (
      !this.#identity ||
      this.pending ||
      this.restoring ||
      this.#saving ||
      this.#session.status !== "ready"
    )
      return;
    if (this.#api.mode !== "live" || this.#api.generation !== this.#modeGeneration) return;
    const state = this.#session.checkpoint(this.#player.playbackPosition());
    const serialized = JSON.stringify(state);
    if (serialized === this.#lastState) return;
    const input = { ...this.#identity, state };
    const generation = this.#generation;
    const client = this.#api.pinned();
    this.#saving = true;
    try {
      await client.putSession(input);
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

  async resume(): Promise<void> {
    const saved = this.pending;
    const config = this.#settings.value;
    if (!saved || !config || this.restoring) return;
    const generation = this.#generation;
    const client = this.#api.pinned();
    this.restoring = true;
    this.#player.pauseForResume();
    try {
      const resolved = await client.resolveSession(saved.id);
      if (generation !== this.#generation || this.#api.generation !== this.#modeGeneration) return;
      await this.#settings.save({
        ...config,
        filters: saved.config.filters,
        queue: saved.config.queue,
        player: saved.config.player,
      });
      if (generation !== this.#generation || this.#api.generation !== this.#modeGeneration) return;
      this.#restorePlayback(resolved);
      await this.#session.restoreSession(resolved);
      if (generation !== this.#generation) return;
      this.#identity = { id: saved.id, startedAt: saved.startedAt };
      this.#player.sessionId = saved.id;
      this.#lastState = "";
      this.pending = null;
      this.message =
        resolved.unavailable > 0
          ? `Session resumed. ${resolved.unavailable} saved records are now decided, filtered out, or missing. Press Space to listen.`
          : "Session resumed. Press Space to listen.";
    } catch (error) {
      if (generation === this.#generation)
        this.message = `Could not resume the session: ${errorMessage(error)}`;
    } finally {
      if (generation === this.#generation) this.restoring = false;
    }
  }

  #restorePlayback(resolved: SessionResolution): void {
    const currentId = resolved.round?.[0]?.release?.id ?? resolved.current?.id;
    const playback = resolved.session.state.playback;
    this.#player.restorePlayback(playback?.releaseId === currentId ? playback : null);
  }

  destroy(): void {
    this.#generation += 1;
    this.#identity = null;
  }
}
