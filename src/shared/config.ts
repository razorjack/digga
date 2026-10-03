import { z } from "zod";

export const QUEUE_STRATEGIES = ["label_sweep", "country", "year", "random"] as const;
export type QueueStrategy = (typeof QUEUE_STRATEGIES)[number];

export const COLOR_SCHEMES = ["system", "light", "dark"] as const;

/** Where the server may listen: on this computer only, never on a network. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"] as const;

/** The currencies Discogs' API prices releases in (`curr_abbr`); it has no PLN, for example. */
export const DISCOGS_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "MXN",
  "BRL",
  "NZD",
  "SEK",
  "ZAR",
] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/**
 * A label left out of the queue, by Discogs id; an entry typed in Settings has no id and matches
 * the name. Configs before ids held the names alone.
 */
const HiddenLabelSchema = z.preprocess(
  (value) => (typeof value === "string" ? { id: null, name: value } : value),
  z.object({ id: z.number().int().positive().nullable(), name: z.string().min(1) }),
);
export type HiddenLabel = z.infer<typeof HiddenLabelSchema>;

// Genre/style defaults for the owner's use case live here and in
// digga.config.json only. Nothing else in the codebase may assume them.
export const FiltersSchema = z.object({
  /** Query-time style subset; null means every loaded style. */
  styles: z.array(z.string().min(1)).nullable().default(null),
  yearFrom: z.number().int().nullable().default(1998),
  yearTo: z.number().int().nullable().default(2002),
  includeUnknownYear: z.boolean().default(false),
  /**
   * Releases without a year on the labels, or by the artists, of the records you want or own;
   * the coverage labels and artists (decision 90). Moot with includeUnknownYear.
   */
  includeUnknownYearOnCoverage: z.boolean().default(true),
  formats: z.array(z.string().min(1)).default(["Vinyl"]),
  countries: z.array(z.string().min(1)).default([]),
  /** Leave out releases opened before, as the browser history import recorded them. */
  skipHistory: z.boolean().default(true),
  /** Leave out releases without an embeddable video, so every record in the queue can play. */
  skipWithoutVideos: z.boolean().default(false),
  /** Labels left out, matched against a release's first label (the one the sweep uses). */
  excludeLabels: z.array(HiddenLabelSchema).default([]),
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
      host: z.enum(LOOPBACK_HOSTS).default("127.0.0.1"),
      port: z.number().int().min(0).max(65535).default(3456),
    })
    .prefault({}),
  discogs: z
    .object({
      username: z.string().default(""),
      currency: z.string().length(3).default("EUR"),
      /** The Discogs list that holds maybes; the M verdict appears when it is set. */
      maybeListId: z.number().int().positive().nullable().default(null),
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
      // "popular" (most wanted first) was removed with bulk enrichment; it falls back to the sweep.
      strategy: z
        .preprocess(
          (value) => (value === "popular" ? "label_sweep" : value),
          z.enum(QUEUE_STRATEGIES),
        )
        .default("label_sweep"),
      limit: z.number().int().positive().max(5000).default(200),
    })
    .prefault({}),
  player: z
    .object({
      /** Start a record on, and move forward to, tunes not heard before. */
      skipHeard: z.boolean().default(true),
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
  setup: z
    .object({
      /**
       * The setup's step 3 wrote the styles, years and formats, so they are the user's picks and
       * not the defaults a new config starts with; the setup starts from them when it returns.
       */
      picksConfirmed: z.boolean().default(false),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type Filters = Config["filters"];

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/** The filters with a label left out of the queue, or let back in. */
export function withLabelExcluded(
  filters: Filters,
  label: HiddenLabel,
  excluded: boolean,
): Filters {
  const others = filters.excludeLabels.filter((hidden) => !isSameLabel(hidden, label));
  return { ...filters, excludeLabels: excluded ? [...others, label] : others };
}

/**
 * Hidden labels for Settings' lines of names. A line that names a hidden label keeps that entry
 * and its id; a new name has no id.
 */
export function hiddenLabelsFromNames(names: string[], hidden: HiddenLabel[]): HiddenLabel[] {
  return names.map(
    (name) => hidden.find((label) => isSameName(label.name, name)) ?? { id: null, name },
  );
}

/** The same label: by Discogs id when both have one, otherwise by name, ignoring case. */
function isSameLabel(left: HiddenLabel, right: HiddenLabel): boolean {
  if (left.id !== null && right.id !== null) return left.id === right.id;
  return isSameName(left.name, right.name);
}

const isSameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

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
