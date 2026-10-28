import { type Context, Hono } from "hono";
import type { ApiError } from "../../shared/api.ts";
import { ConfigSchema } from "../../shared/config.ts";
import type { AppContext } from "../context.ts";
import { accountConflict } from "../db/memberships.ts";
import { parseJson } from "./request.ts";

export function registerSettingsRoutes(api: Hono, context: AppContext): void {
  api.get("/settings", (c) => settings(c, context));
  api.put("/settings", (c) => saveSettings(c, context));
}

function settings(c: Context, context: AppContext) {
  return c.json(context.getConfig());
}

/** A username of another account is refused while the library holds one account's data. */
async function saveSettings(c: Context, context: AppContext) {
  const body = await parseJson(c, ConfigSchema);
  if (!body.ok) return body.response;
  const configured = context.getConfig().discogs.username;
  const conflict = accountConflict(context.db, body.data.discogs.username, configured);
  if (conflict !== null) return c.json({ error: conflict } satisfies ApiError, 409);

  context.setConfig(body.data);
  return c.json(context.getConfig());
}
