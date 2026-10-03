import { type Context, Hono } from "hono";
import {
  type DeleteVerdictResponse,
  ListenLogInputSchema,
  type ListenLogResponse,
  ReleaseNoteInputSchema,
  TrackVerdictInputSchema,
  VerdictInputSchema,
} from "../../shared/api.ts";
import { TrackIdentityConflict } from "../../shared/track-identity.ts";
import { saveReleaseNote } from "../db/notes.ts";
import { getRelease } from "../db/releases.ts";
import { deleteVerdict, logListen, setTrackVerdict, upsertVerdict } from "../db/verdicts.ts";
import { recordKeyOf } from "../db/verdict-keys.ts";
import { recordNoAudioVideos } from "../queue/no-audio.ts";
import type { AppContext } from "../context.ts";
import { badRequest, parseId, parseJson, refuseInSandbox } from "./request.ts";

export function registerVerdictsRoutes(api: Hono, context: AppContext): void {
  api.put("/releases/:id/note", (request) => saveNote(request, context));
  api.post("/verdicts", (request) => saveVerdict(request, context));
  api.delete("/verdicts/:key", (request) => removeVerdict(request, context));
  api.post("/track-verdicts", (request) => saveTrackMark(request, context));
  api.post("/listen-log", (request) => listen(request, context));
}

async function saveVerdict(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const body = await parseJson(request, VerdictInputSchema);
  if (!body.ok) return body.response;
  // A page that read the queue before a dump load may send the key the release had then.
  const verdict = upsertVerdict(db, { ...body.data, key: recordKeyOf(db, body.data) });
  // A later video that was not there now sends the record back to the queue.
  if (verdict.status === "no_audio") recordNoAudioVideos(db, verdict);
  return request.json(verdict);
}

function removeVerdict(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const previous = deleteVerdict(db, request.req.param("key") ?? "");
  const body: DeleteVerdictResponse = { deleted: previous !== null, previous };
  return request.json(body);
}

async function saveTrackMark(request: Context, context: AppContext) {
  const { db } = context;
  const refused = refuseInSandbox(request, context);
  if (refused) return refused;
  const body = await parseJson(request, TrackVerdictInputSchema);
  if (!body.ok) return body.response;
  try {
    return request.json(setTrackVerdict(db, body.data));
  } catch (error) {
    if (!(error instanceof TrackIdentityConflict)) throw error;
    return request.json({ error: error.message }, 409);
  }
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
