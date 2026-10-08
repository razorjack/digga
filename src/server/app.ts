import { JobInputError } from "./jobs/start.ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ApiError } from "../shared/api.ts";
import { DiscogsApiError } from "./discogs/client.ts";
import { createStaticHandler } from "./static.ts";
import { registerCatalogRoutes } from "./routes/catalog.ts";
import { registerVerdictsRoutes } from "./routes/verdicts.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerJobsRoutes } from "./routes/jobs.ts";
import { registerDiscogsRoutes } from "./routes/discogs.ts";
import { registerDataRoutes } from "./routes/data.ts";
import { registerSetupRoutes } from "./routes/setup.ts";
import { registerDesktopRoutes } from "./routes/desktop.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import type { AppContext } from "./context.ts";
import { discogsErrorMessage } from "./routes/request.ts";
import { localOnly } from "./local-only.ts";

/** Room for the largest body the client sends: a session with 50,000 passed releases. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function createApp(context: AppContext): Hono {
  const app = new Hono();
  const api = new Hono();
  const { logger } = context;
  app.use(localOnly());
  api.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (request) =>
        request.json({ error: "The request body is too large" } satisfies ApiError, 413),
    }),
  );
  registerSessionRoutes(api, context);
  registerCatalogRoutes(api, context);
  registerVerdictsRoutes(api, context);
  registerSettingsRoutes(api, context);
  registerJobsRoutes(api, context);
  registerDiscogsRoutes(api, context);
  registerDataRoutes(api, context);
  registerSetupRoutes(api, context);
  registerDesktopRoutes(api, context);
  app.route("/api", api);
  app.all("/api/*", (request) =>
    request.json(
      { error: `No such API route: ${request.req.method} ${request.req.path}` } satisfies ApiError,
      404,
    ),
  );
  app.onError((error, request) => {
    if (error instanceof JobInputError) return request.json({ error: error.message }, 400);
    if (error instanceof DiscogsApiError) {
      logger.warn(`${request.req.method} ${request.req.path}: Discogs answered ${error.status}`);
      return request.json({ error: discogsErrorMessage(error) } satisfies ApiError, 502);
    }
    logger.error(`${request.req.method} ${request.req.path} failed`, error);
    return request.json({ error: error.message } satisfies ApiError, 500);
  });
  if (context.serveStatic) {
    const serveDist = createStaticHandler(context.paths.distDir);
    app.get("*", (request) => serveDist(request));
  }
  return app;
}
