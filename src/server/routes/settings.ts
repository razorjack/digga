import { type Context, Hono } from "hono";
import { ConfigSchema } from "../../shared/config.ts";
import type { AppContext } from "../context.ts";
import { parseJson } from "./request.ts";

export function registerSettingsRoutes(api: Hono, context: AppContext): void {
  api.get("/settings", (request) => settings(request, context));
  api.put("/settings", (request) => saveSettings(request, context));
}

function settings(request: Context, context: AppContext) {
  return request.json(context.getConfig());
}

async function saveSettings(request: Context, context: AppContext) {
  const body = await parseJson(request, ConfigSchema);
  if (!body.ok) return body.response;
  context.setConfig(body.data);
  return request.json(context.getConfig());
}
