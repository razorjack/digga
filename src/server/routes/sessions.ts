import type { Context, Hono } from "hono";
import { SessionInputSchema } from "../../shared/digging-session.ts";
import { getSession, latestSession, saveSession } from "../db/digging-sessions.ts";
import { resolveSession } from "../queue/resume.ts";
import type { AppContext } from "../context.ts";
import { parseJson } from "./request.ts";

/** Saved digging sessions: where Triage was, so a later visit can resume there. */
export function registerSessionRoutes(api: Hono, context: AppContext): void {
  api.get("/sessions/latest", (request) => request.json(latestSession(context.db)));
  api.put("/sessions/current", (request) => saveCurrentSession(request, context));
  api.get("/sessions/:id/resume", (request) => resumeSession(request, context));
}

async function saveCurrentSession(request: Context, context: AppContext) {
  const input = await parseJson(request, SessionInputSchema);
  if (!input.ok) return input.response;
  saveSession(context.db, input.data, context.getConfig());
  return request.json({ saved: true });
}

function resumeSession(request: Context, context: AppContext) {
  const session = getSession(context.db, request.req.param("id") ?? "");
  if (!session) return request.json({ error: "Session not found" }, 404);
  return request.json(resolveSession(context.db, session));
}
