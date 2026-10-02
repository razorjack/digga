import type { Stats, TwelvesItem } from "../shared/api.ts";
import type { ColorScheme, Config } from "../shared/config.ts";
import type { ScopeRef } from "../shared/scope.ts";
import { api } from "./api.ts";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StatsStore {
  value = $state<Stats | null>(null);
  error = $state<string | null>(null);
  /** Verdicts given since the app was opened, net of undos. */
  session = $state(0);
  /** The label, artist or seller Triage digs; the stats also count what is left in it. */
  scope: ScopeRef | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** The next refresh counts the records left in the scope; until then the count is unknown. */
  setScope(scope: ScopeRef | null): void {
    this.scope = scope;
    if (this.value) this.value = { ...this.value, scopeRemaining: null };
  }

  async refresh(): Promise<void> {
    const scope = this.scope;
    try {
      const value = await api.getStats({ scope: scope ?? undefined });
      // The count belongs to the scope asked about; a refresh for the new one follows.
      if (scope !== this.scope) return;
      this.value = value;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
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
  /** A read is out, the app's first or a retry. */
  loading = $state(false);
  /** Increments on every save but a color scheme change, so the triage queue knows to reload. */
  version = $state(0);
  /** True until the config says otherwise, like the api, so nothing is saved before it is known. */
  sandbox = $derived(this.value?.sandbox ?? true);
  #colorSchemeWrites: Promise<unknown> = Promise.resolve();
  #read: Promise<void> | null = null;

  async load(): Promise<void> {
    const read = this.#readSettings();
    this.#read = read;
    this.loading = true;
    await read;
    if (this.#read !== read) return;
    this.#read = null;
    this.loading = false;
  }

  /** After a failed read: reads again, or waits for the read already out, so a key held down asks once. */
  retry(): Promise<void> {
    return this.#read ?? this.load();
  }

  async #readSettings(): Promise<void> {
    try {
      this.#apply(await api.getSettings());
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async save(next: Config): Promise<Config> {
    const saved = await api.putSettings(next);
    this.#apply(saved);
    this.version += 1;
    return saved;
  }

  /**
   * Saves the color scheme without restarting the queue. Each save waits for the one before and
   * starts from the config it returned, so quick changes are saved in the order they were made.
   */
  saveColorScheme(colorScheme: ColorScheme): Promise<Config> {
    const write = this.#colorSchemeWrites.then(() => this.#putColorScheme(colorScheme));
    this.#colorSchemeWrites = write.catch(() => undefined);
    return write;
  }

  async #putColorScheme(colorScheme: ColorScheme): Promise<Config> {
    if (!this.value) throw new Error("the settings have not loaded");
    const saved = await api.putSettings({
      ...$state.snapshot(this.value),
      appearance: { colorScheme },
    });
    this.#apply(saved);
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

/** Records a practice round lasts; the setup offers it before digging for real. */
export const PRACTICE_RECORDS = 5;

class UiStore {
  /** The ? overlay is open; page shortcuts stay quiet while it is. */
  helpOpen = $state(false);
  /** A practice round in the sandbox: the verdicts given so far; null outside one. */
  practice = $state<{ judged: number } | null>(null);
  /** Snoozed records Twelves hands to Triage to hear again; Triage takes them and clears this. */
  snoozedRound = $state.raw<TwelvesItem[] | null>(null);
}

export const ui = new UiStore();
