import { type Context, Hono } from "hono";
import type { AppContext } from "../context.ts";
import { readSetup } from "../setup.ts";
import { readStyleCensus } from "../style-census.ts";

/** The first run: what it needs to know, and the style census for its style picker. */
export function registerSetupRoutes(api: Hono, context: AppContext): void {
  api.get("/setup", (request) => setup(request, context));
  api.get("/styles", (request) => request.json(readStyleCensus(context.db)));
}

async function setup(request: Context, context: AppContext) {
  return request.json(await readSetup(context));
}
