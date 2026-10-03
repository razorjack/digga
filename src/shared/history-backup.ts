import { z } from "zod";
import { toUtcTimestamp } from "./timestamp.ts";
import { TRACK_MARKS, VERDICT_SOURCES, VERDICT_STATUSES } from "./types.ts";

const text = z.string().nullable();
const number = z.number().nullable();
const event = {
  event_id: z.string().min(1),
  at: z.string(),
  change: z.enum(["existing", "insert", "update", "delete"]),
};

export const HISTORY_SCHEMAS = {
  releaseNotes: z.object({ release_id: z.number(), notes: text, updated_at: z.string() }),
  listenLog: z.object({
    event_id: event.event_id,
    release_id: z.number(),
    position: text,
    video_id: z.string(),
    seconds: z.number(),
    at: z.string(),
    heard_key: text.default(null),
    artist_display: text.default(null),
    title: text.default(null),
    playback_id: text.default(null),
    session_id: text.default(null),
    started_at: text.default(null),
    start_seconds: number.default(null),
    end_seconds: number.default(null),
    heard: number.default(null),
    video_title: text.default(null),
  }),
  verdictLog: z.object({
    ...event,
    key: z.string(),
    previous_key: text,
    status: z.enum(VERDICT_STATUSES),
    source: z.enum(VERDICT_SOURCES),
    notes: text,
    release_id: number,
    // Seed decisions logged before Digga stored UTC throughout kept Discogs' offset.
    decided_at: z.string().transform(toUtcTimestamp),
  }),
  trackMarkLog: z.object({
    ...event,
    release_id: z.number(),
    position: z.string(),
    mark: z.enum(TRACK_MARKS),
    notes: text,
    decided_at: z.string(),
    heard_key: text,
    artist_display: text,
    title: text,
    video_id: text,
    at_seconds: number,
  }),
};
