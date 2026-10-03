import type { Context, MiddlewareHandler } from "hono";
import type { ApiError } from "../shared/api.ts";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Answers only the app itself and tools on this computer. Every request has to name a loopback
 * host, which a site that points its own name at 127.0.0.1 (DNS rebinding) cannot. A write sent
 * from a page has to come from the app's own page, because browsers send any site's simple POST
 * without asking first. Tools such as curl send no Origin and are let through.
 */
export function localOnly(): MiddlewareHandler {
  return async (request, next) => {
    const url = new URL(request.req.url);
    if (!LOOPBACK_HOSTNAMES.has(url.hostname))
      return refuse(request, `Digga answers on localhost only, not on ${url.hostname}`);

    const origin = request.req.header("origin");
    if (!READ_METHODS.has(request.req.method) && origin !== undefined && !isOwnPage(origin, url))
      return refuse(request, `Digga takes changes only from its own page, not from ${origin}`);

    await next();
  };
}

/**
 * The page is this server's when it is on the same port under any loopback name: the app can be
 * opened on localhost or 127.0.0.1, and a request may reach the server under the other name.
 */
function isOwnPage(origin: string, url: URL): boolean {
  const page = URL.parse(origin);
  if (page === null) return false;
  return (
    LOOPBACK_HOSTNAMES.has(page.hostname) &&
    page.protocol === url.protocol &&
    page.port === url.port
  );
}

function refuse(request: Context, message: string): Response {
  return request.json({ error: message } satisfies ApiError, 403);
}
