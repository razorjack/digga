import type { Context, Hono } from "hono";
import { SessionInputSchema } from "../../shared/digging-session.ts";
import { getSession, latestSession, saveSession } from "../db/digging-sessions.ts";
import { resolveSession } from "../queue/resume.ts";
import type { AppContext } from "../context.ts";
import { parseJson } from "./request.ts";

/** Saved digging sessions: where Triage was, so a later visit can resume there. */
export function registerSessionRoutes(api: Hono, context: AppContext): void {
  api.get("/sessions/latest", (c) => c.json(latestSession(context.db)));
  api.put("/sessions/current", (c) => saveCurrentSession(c, context));
  api.get("/sessions/:id/resume", (c) => resumeSession(c, context));
}

async function saveCurrentSession(c: Context, context: AppContext) {
  const input = await parseJson(c, SessionInputSchema);
  if (!input.ok) return input.response;
  saveSession(context.db, input.data, context.getConfig());
  return c.json({ saved: true });
}

function resumeSession(c: Context, context: AppContext) {
  const session = getSession(context.db, c.req.param("id") ?? "");
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(resolveSession(context.db, session));
}
