import type { Stats } from "../shared/api.ts";
import type { ColorScheme, Config } from "../shared/config.ts";
import type { ReplayRequest } from "../shared/replay.ts";
import type { ScopeRef } from "../shared/scope.ts";
import { api } from "./api.ts";
import { SerialQueue } from "./async.ts";

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
  #writes = new SerialQueue();
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
      this.value = await api.getSettings();
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  save(next: Config): Promise<Config> {
    const before = $state.snapshot(this.value);
    const requested = $state.snapshot(next);
    return this.#writes.run(async () => {
      const config =
        before && this.value
          ? mergeSettings(before, requested, $state.snapshot(this.value))
          : requested;
      const saved = await api.putSettings(config);
      this.value = saved;
      this.version += 1;
      return saved;
    });
  }

  /** Theme changes share the settings write queue but do not restart Triage. */
  saveColorScheme(colorScheme: ColorScheme): Promise<Config> {
    return this.#writes.run(() => this.#putColorScheme(colorScheme));
  }

  async #putColorScheme(colorScheme: ColorScheme): Promise<Config> {
    if (!this.value) throw new Error("the settings have not loaded");
    const saved = await api.putSettings({
      ...$state.snapshot(this.value),
      appearance: { colorScheme },
    });
    this.value = saved;
    return saved;
  }
}

/** Apply only the caller's edits, keeping unrelated settings saved while it waited. */
function mergeSettings(before: Config, requested: Config, current: Config): Config {
  return {
    server: mergeFields(before.server, requested.server, current.server),
    discogs: mergeFields(before.discogs, requested.discogs, current.discogs),
    universe: mergeFields(before.universe, requested.universe, current.universe),
    filters: mergeFields(before.filters, requested.filters, current.filters),
    queue: mergeFields(before.queue, requested.queue, current.queue),
    player: mergeFields(before.player, requested.player, current.player),
    appearance: mergeFields(before.appearance, requested.appearance, current.appearance),
    setup: mergeFields(before.setup, requested.setup, current.setup),
  };
}

function mergeFields<T extends object>(before: T, requested: T, current: T): T {
  const merged = { ...current };
  for (const key of Object.keys(requested) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(requested[key]))
      merged[key] = requested[key];
  }
  return merged;
}

export const stats = new StatsStore();
export const settings = new SettingsStore();

class UiStore {
  /** The ? overlay is open; page shortcuts stay quiet while it is. */
  helpOpen = $state(false);
  /** Records or a bookmarked track Twelves hands to Triage; Triage takes them and clears this. */
  replay = $state.raw<ReplayRequest | null>(null);
}

export const ui = new UiStore();
