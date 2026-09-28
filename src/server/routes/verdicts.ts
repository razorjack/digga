import { type Context, Hono } from "hono";
import {
  type DeleteVerdictResponse,
  ListenLogInputSchema,
  type ListenLogResponse,
  TrackVerdictInputSchema,
  VerdictInputSchema,
} from "../../shared/api.ts";
import { deleteVerdict, logListen, setTrackVerdict, upsertVerdict } from "../db/verdicts.ts";
import { recordNoAudioVideos } from "../queue/no-audio.ts";
import type { AppContext } from "../context.ts";
import { parseJson, refuseInSandbox } from "./request.ts";

export function registerVerdictsRoutes(api: Hono, context: AppContext): void {
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
  const verdict = upsertVerdict(db, body.data);
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
