import { z } from "zod";

export const QUEUE_STRATEGIES = ["label_sweep", "popular", "country", "year", "random"] as const;
export type QueueStrategy = (typeof QUEUE_STRATEGIES)[number];

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
});

export const ConfigSchema = z.object({
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
    })
    .prefault({}),
  universe: z
    .object({
      styles: z.array(z.string().min(1)).default(["Drum n Bass"]),
      loadYears: z.tuple([z.number().int(), z.number().int()]).nullable().default([1994, 2008]),
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
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type Filters = Config["filters"];

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

export function parseConfig(input: unknown): Config {
  return ConfigSchema.parse(input);
}

/** Returns the parsed config or a list of human-readable problems. */
export function validateConfig(
  input: unknown,
): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const result = ConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
  );
  return { ok: false, errors };
}
