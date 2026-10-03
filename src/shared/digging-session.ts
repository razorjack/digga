import { z } from "zod";
import { ConfigSchema } from "./config.ts";
import { ScopeRefSchema } from "./scope.ts";
import { TuneSnapshotSchema, type QueueItem } from "./api.ts";
import type { ReplayItem } from "./replay.ts";

const releaseId = z.number().int().positive();
const cursor = z.object({
  currentId: releaseId.nullable(),
  passedIds: z.array(releaseId).max(50000),
});
export const SessionStateSchema = cursor.extend({
  seed: z.number().int().nullable().default(null),
  scope: ScopeRefSchema.extend({ name: z.string() }).nullable(),
  roundIds: z.array(releaseId).max(50000).nullable(),
  queueBeforeRound: cursor.nullable(),
  playback: z
    .object({
      releaseId,
      videoId: z.string().min(1),
      atSeconds: z.number().nonnegative(),
      tune: TuneSnapshotSchema.optional(),
    })
    .nullable(),
});
export const SessionInputSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  state: SessionStateSchema,
});
export const SavedSessionSchema = SessionInputSchema.extend({
  updatedAt: z.iso.datetime(),
  config: ConfigSchema,
  dumpDate: z.string().nullable(),
  schemaVersion: z.number().int(),
});
export const SessionRowSchema = z.object({
  id: z.uuid(),
  started_at: z.string(),
  updated_at: z.string(),
  config_json: z.string(),
  dump_date: z.string().nullable(),
  schema_version: z.number().int(),
  state_json: z.string(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionInput = z.infer<typeof SessionInputSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type SessionRow = z.infer<typeof SessionRowSchema>;

export interface SessionResolution {
  session: SavedSession;
  current: QueueItem | null;
  passed: QueueItem[];
  round: ReplayItem[] | null;
  unavailable: number;
}

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
