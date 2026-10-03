import { z } from "zod";
import { TuneSnapshotSchema, type QueueItem } from "./api.ts";
import { ConfigSchema } from "./config.ts";
import type { ReplayItem } from "./replay.ts";
import { ScopeRefSchema } from "./scope.ts";

const releaseId = z.number().int().positive();

/** A position in the queue: the record on the desk and those passed with N. */
const CursorSchema = z.object({
  currentId: releaseId.nullable(),
  passedIds: z.array(releaseId).max(50000),
});

/** Where a digging session is, by release id, so it survives a reload of the queue. */
export const SessionStateSchema = CursorSchema.extend({
  /** The queue order's random seed; null for an order that needs none. */
  seed: z.number().int().nullable().default(null),
  scope: ScopeRefSchema.extend({ name: z.string() }).nullable(),
  /** The records left in a round from Twelves; null outside one. */
  roundIds: z.array(releaseId).max(50000).nullable(),
  /** The queue position to return to after the round. */
  queueBeforeRound: CursorSchema.nullable(),
  playback: z
    .object({
      releaseId,
      videoId: z.string().min(1),
      atSeconds: z.number().nonnegative(),
      tune: TuneSnapshotSchema.optional(),
    })
    .nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// PUT /api/sessions/current
export const SessionInputSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  state: SessionStateSchema,
});
export type SessionInput = z.infer<typeof SessionInputSchema>;

// GET /api/sessions/latest
export const SavedSessionSchema = SessionInputSchema.extend({
  updatedAt: z.iso.datetime(),
  /** The settings when the session started; resuming brings back its filters, queue and player. */
  config: ConfigSchema,
  dumpDate: z.string().nullable(),
  schemaVersion: z.number().int(),
});
export type SavedSession = z.infer<typeof SavedSessionSchema>;

// GET /api/sessions/:id/resume
export interface SessionResolution {
  session: SavedSession;
  current: QueueItem | null;
  passed: QueueItem[];
  round: ReplayItem[] | null;
  /** Saved records that are now decided, filtered out or missing from the catalogue. */
  unavailable: number;
}

/** A digging_sessions row, as the decisions backup stores it. */
export const SessionRowSchema = z.object({
  id: z.uuid(),
  started_at: z.string(),
  updated_at: z.string(),
  config_json: z.string(),
  dump_date: z.string().nullable(),
  schema_version: z.number().int(),
  state_json: z.string(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

/** Parses a row's JSON columns; throws when they do not hold a session. */
export function sessionFromRow(row: SessionRow): SavedSession {
  return SavedSessionSchema.parse({
    id: row.id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    config: JSON.parse(row.config_json),
    dumpDate: row.dump_date,
    schemaVersion: row.schema_version,
    state: JSON.parse(row.state_json),
  });
}
