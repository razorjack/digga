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
import { badRequest, parseId, parseJson, parseQuery, refuseInSandbox } from "./request.ts";

export function registerVerdictsRoutes(api: Hono, context: AppContext): void {
  api.put("/releases/:id/note", (request) => saveNote(request, context));
  api.post("/verdicts", (request) => saveVerdict(request, context));
  api.delete("/verdicts/:key", (request) => removeVerdict(request, context));
  api.post("/track-verdicts", (request) => saveTrackMark(request, context));
  api.post("/listen-log", (request) => listen(request, context));
}

const VERDICT_CHANGED: ApiError = {
  error:
    "The record's verdict changed since this page read it, in another tab or by a load; reload to see it",
};

async function saveVerdict(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const body = await parseJson(request, VerdictInputSchema);
  if (!body.ok) return body.response;
  const { expected, ...input } = body.data;
  // A page that read the queue before a dump load may send the key the release had then.
  const key = recordKeyOf(db, input);
  if (expected && !isVerdictStill(db, key, expected)) return request.json(VERDICT_CHANGED, 409);

  const verdict = upsertVerdict(db, { ...input, key });
  // A later video that was not there now sends the record back to the queue.
  if (verdict.status === "no_audio") recordNoAudioVideos(db, verdict);
  return request.json(verdict);
}

function removeVerdict(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const expected = parseQuery(request, ExpectedVerdictSchema);
  if (!expected.ok) return expected.response;
  const key = request.req.param("key") ?? "";
  if (!isVerdictStill(db, key, expected.data)) return request.json(VERDICT_CHANGED, 409);

  const previous = deleteVerdict(db, key);
  const body: DeleteVerdictResponse = { deleted: previous !== null, previous };
  return request.json(body);
}

async function saveTrackMark(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const body = await parseJson(request, TrackVerdictInputSchema);
  if (!body.ok) return body.response;
  return request.json(setTrackVerdict(db, body.data));
}

async function listen(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const body = await parseJson(request, ListenLogInputSchema);
  if (!body.ok) return body.response;
  const listen = logListen(db, { ...body.data, position: body.data.position ?? null });
  const res: ListenLogResponse = { id: listen.id, heardKey: listen.heardKey };
  return request.json(res);
}

async function saveNote(request: Context, context: AppContext) {
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const id = parseId(request.req.param("id") ?? "");
  if (id === null) return badRequest(request, "Invalid release id");
  if (!getRelease(context.db, id)) return request.json({ error: "Release not found" }, 404);
  const body = await parseJson(request, ReleaseNoteInputSchema);
  if (!body.ok) return body.response;
  saveReleaseNote(context.db, id, body.data.notes);
  return request.json(body.data);
}
