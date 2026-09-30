import type { BrowserContext, Route } from "@playwright/test";

/** A request of the page to its own server, by method and decoded path. */
export interface RequestMatch {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Such as "/api/verdicts"; the query string is not compared. */
  path: string;
}

/**
 * Aborts the page's next `times` requests that match, as a dropped connection would; the
 * transport failure is the one thing a test may fake about Digga's own /api (docs/E2E_TESTING.md,
 * "The fake services"). Registered after the base route, it passes every other request back to
 * it with route.fallback(), since Playwright tries the newest matching route first.
 */
export async function abortRequests(
  context: BrowserContext,
  match: RequestMatch,
  options: { times: number; onAbort: (request: string) => void },
): Promise<void> {
  let remaining = options.times;
  await context.route("**/*", async (route: Route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (remaining === 0 || request.method() !== match.method || path !== match.path) {
      await route.fallback();
      return;
    }
    remaining -= 1;
    options.onAbort(`${match.method} ${match.path}`);
    await route.abort("failed");
  });
}
