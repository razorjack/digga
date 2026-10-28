import { type Context, Hono } from "hono";
import {
  type ApiError,
  type DeleteVerdictResponse,
  ExpectedVerdictSchema,
  ListenLogInputSchema,
  type ListenLogResponse,
  ReleaseNoteInputSchema,
  TrackVerdictInputSchema,
  VerdictInputSchema,
} from "../../shared/api.ts";
import { saveReleaseNote } from "../db/notes.ts";
import { getRelease } from "../db/releases.ts";
import {
  deleteVerdict,
  isVerdictStill,
  logListen,
  setTrackVerdict,
  upsertVerdict,
} from "../db/verdicts.ts";
import { recordKeyOf } from "../db/verdict-keys.ts";
import { recordNoAudioVideos } from "../queue/no-audio.ts";
import type { AppContext } from "../context.ts";
import { badRequest, paramId, parseJson, parseQuery } from "./request.ts";

export function registerVerdictsRoutes(api: Hono, context: AppContext): void {
  api.put("/releases/:id/note", (c) => saveNote(c, context));
  api.post("/verdicts", (c) => saveVerdict(c, context));
  api.delete("/verdicts/:key", (c) => removeVerdict(c, context));
  api.post("/track-verdicts", (c) => saveTrackMark(c, context));
  api.post("/listen-log", (c) => listen(c, context));
}

const VERDICT_CHANGED: ApiError = {
  error:
    "The record's verdict changed since this page read it, in another tab or by a load; reload to see it",
};

async function saveVerdict(c: Context, context: AppContext) {
  const { db } = context;
  const body = await parseJson(c, VerdictInputSchema);
  if (!body.ok) return body.response;
  const { expected, ...input } = body.data;
  // A page that read the queue before a dump load may send the key the release had then.
  const key = recordKeyOf(db, input);
  if (expected && !isVerdictStill(db, key, expected)) return c.json(VERDICT_CHANGED, 409);

  const verdict = upsertVerdict(db, { ...input, key });
  // A later video that was not there now sends the record back to the queue.
  if (verdict.status === "no_audio") recordNoAudioVideos(db, verdict);
  return c.json(verdict);
}

function removeVerdict(c: Context, context: AppContext) {
  const { db } = context;
  const expected = parseQuery(c, ExpectedVerdictSchema);
  if (!expected.ok) return expected.response;
  const key = c.req.param("key") ?? "";
  if (!isVerdictStill(db, key, expected.data)) return c.json(VERDICT_CHANGED, 409);

  const previous = deleteVerdict(db, key);
  const body: DeleteVerdictResponse = { deleted: previous !== null, previous };
  return c.json(body);
}

async function saveTrackMark(c: Context, context: AppContext) {
  const { db } = context;
  const body = await parseJson(c, TrackVerdictInputSchema);
  if (!body.ok) return body.response;
  return c.json(setTrackVerdict(db, body.data));
}

async function listen(c: Context, context: AppContext) {
  const { db } = context;
  const body = await parseJson(c, ListenLogInputSchema);
  if (!body.ok) return body.response;
  const listen = logListen(db, { ...body.data, position: body.data.position ?? null });
  const res: ListenLogResponse = { id: listen.id, heardKey: listen.heardKey };
  return c.json(res);
}

async function saveNote(c: Context, context: AppContext) {
  const id = paramId(c, "id");
  if (id === null) return badRequest(c, "Invalid release id");
  if (!getRelease(context.db, id)) return c.json({ error: "Release not found" }, 404);
  const body = await parseJson(c, ReleaseNoteInputSchema);
  if (!body.ok) return body.response;
  saveReleaseNote(context.db, id, body.data.notes);
  return c.json(body.data);
}
