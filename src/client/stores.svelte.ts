import type { Stats } from "../shared/api.ts";
import type { Config } from "../shared/config.ts";
import { api } from "./api.ts";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Triage verdicts count as rinsed; seeds from Discogs and browser history do not. */
export function rinsedCount(s: Stats): number {
  const v = s.verdicts;
  return v.rejected + v.accepted + v.maybe + v.candidate + v.no_audio;
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

  async load(): Promise<void> {
    try {
      this.value = await api.getSettings();
      this.error = null;
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async save(next: Config): Promise<Config> {
    const saved = await api.putSettings(next);
    this.value = saved;
    this.version += 1;
    return saved;
  }
}

export const stats = new StatsStore();
export const settings = new SettingsStore();

class UiStore {
  /** The ? overlay is open; page shortcuts stay quiet while it is. */
  helpOpen = $state(false);
}

export const ui = new UiStore();
