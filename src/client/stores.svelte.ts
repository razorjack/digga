import type { Stats, TwelvesItem } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import { api } from "./api.ts";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class StatsStore {
  value = $state<Stats | null>(null);
  error = $state<string | null>(null);
  /** Verdicts given since the app was opened, net of undos. */
  session = $state(0);
  #timer: ReturnType<typeof setTimeout> | null = null;

  async refresh(): Promise<void> {
    try {
      this.value = await api.getStats();
      this.error = null;
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Coalesces the refreshes of a burst of verdicts into one request. */
  refreshSoon(delayMs = 500): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.refresh();
    }, delayMs);
  }
}

class SettingsStore {
  value = $state<Config | null>(null);
  error = $state<string | null>(null);
  /** Increments on every save, so the triage queue knows to reload. */
  version = $state(0);
  /** True until the config says otherwise, like the api, so nothing is saved before it is known. */
  sandbox = $derived(this.value?.sandbox ?? true);

  async load(): Promise<void> {
    try {
      this.#apply(await api.getSettings());
      this.error = null;
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async save(next: Config): Promise<Config> {
    const saved = await api.putSettings(next);
    this.#apply(saved);
    this.version += 1;
    return saved;
  }

  /** Switches the api before anything reacts to the new settings, e.g. by restarting the queue. */
  #apply(config: Config): void {
    const generation = api.generation;
    api.setSandbox(config.sandbox);
    if (api.generation !== generation) {
      stats.session = 0;
      void stats.refresh();
    }
    this.value = config;
  }
}

export const stats = new StatsStore();
export const settings = new SettingsStore();

class UiStore {
  /** The ? overlay is open; page shortcuts stay quiet while it is. */
  helpOpen = $state(false);
  /** Snoozed records Twelves hands to Triage to hear again; Triage takes them and clears this. */
  snoozedRound = $state.raw<TwelvesItem[] | null>(null);
}

export const ui = new UiStore();
