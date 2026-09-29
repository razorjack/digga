import { z } from "zod";

export const QUEUE_STRATEGIES = ["label_sweep", "popular", "country", "year", "random"] as const;
export type QueueStrategy = (typeof QUEUE_STRATEGIES)[number];

export const COLOR_SCHEMES = ["system", "light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

// Genre/style defaults for the owner's use case live here and in
// digga.config.json only. Nothing else in the codebase may assume them.
export const FiltersSchema = z.object({
  /** Query-time style subset; null means every loaded style. */
  styles: z.array(z.string().min(1)).nullable().default(null),
  yearFrom: z.number().int().nullable().default(1998),
  yearTo: z.number().int().nullable().default(2002),
  includeUnknownYear: z.boolean().default(false),
  formats: z.array(z.string().min(1)).default(["Vinyl"]),
  countries: z.array(z.string().min(1)).default([]),
  /** Leave out releases without an embeddable video, so every record in the queue can play. */
  skipWithoutVideos: z.boolean().default(false),
  /** Labels left out, by the exact name of a release's first label (the one the sweep uses). */
  excludeLabels: z.array(z.string().min(1)).default([]),
  /** Format descriptions a release needs one of, such as 12" or EP; empty means any. */
  includeDescriptions: z.array(z.string().min(1)).default([]),
  /** Format descriptions that leave a release out, such as Unofficial Release or Compilation. */
  excludeDescriptions: z.array(z.string().min(1)).default([]),
});

export const ConfigSchema = z.object({
  /**
   * The UI keeps verdicts, track marks and listens in memory and sends nothing to Discogs.
   * On by default, so a first run cannot change anything by accident.
   */
  sandbox: z.boolean().default(true),
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(0).max(65535).default(3456),
    })
    .prefault({}),
  discogs: z
    .object({
      username: z.string().default(""),
      currency: z.string().length(3).default("EUR"),
      /** The Discogs list that holds maybes; the M verdict appears when it is set. */
      maybeListId: z.number().int().positive().nullable().default(null),
      /** Records ahead of the one playing that Triage enriches from Discogs; 0 turns it off. */
      enrichAhead: z.number().int().min(0).max(20).default(5),
    })
    .prefault({}),
  universe: z
    .object({
      styles: z.array(z.string().min(1)).default(["Drum n Bass"]),
      loadYears: z.tuple([z.number().int(), z.number().int()]).nullable().default([1994, 2008]),
      /**
       * Also keep releases in other styles on the labels, and by the artists, of the records you
       * want or own, when at least a third of their releases in the load years carry a style.
       */
      coverage: z.boolean().default(true),
    })
    .prefault({}),
  filters: FiltersSchema.prefault({}),
  queue: z
    .object({
      strategy: z.enum(QUEUE_STRATEGIES).default("label_sweep"),
      limit: z.number().int().positive().max(5000).default(200),
    })
    .prefault({}),
  player: z
    .object({
      startAtFraction: z.number().min(0).max(1).default(0.5),
      seekStepSeconds: z.number().positive().default(10),
    })
    .prefault({}),
  appearance: z
    .object({
      /** "system" follows the operating system's light or dark setting. */
      colorScheme: z.enum(COLOR_SCHEMES).default("system"),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type Filters = Config["filters"];

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/** The filters with a label left out of the queue, or let back in. */
export function withLabelExcluded(filters: Filters, label: string, excluded: boolean): Filters {
  const others = filters.excludeLabels.filter((name) => name !== label);
  return { ...filters, excludeLabels: excluded ? [...others, label] : others };
}

export function parseConfig(input: unknown): Config {
  return ConfigSchema.parse(input);
}

export interface ConfigIssue {
  /** Dotted path of the invalid value, such as "queue.limit"; empty for the whole config. */
  path: string;
  message: string;
}

/** Returns the parsed config, or the problems as issues and as human-readable lines. */
export function validateConfig(
  input: unknown,
): { ok: true; config: Config } | { ok: false; errors: string[]; issues: ConfigIssue[] } {
  const result = ConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  const errors = issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`);
  return { ok: false, errors, issues };
}
