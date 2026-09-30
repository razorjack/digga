import type { BrowserContext, Route } from "@playwright/test";

/** What the browser tried and the guard refused; a test fails on anything it did not declare. */
export interface BrowserGuardLog {
  refused: string[];
  redirects: string[];
  webSockets: string[];
  /** Requests the harness could not fetch for the page, with the reason, for failure artifacts. */
  fetchFailures: string[];
}

export function emptyGuardLog(): BrowserGuardLog {
  return { refused: [], redirects: [], webSockets: [], fetchFailures: [] };
}

/**
 * The browser's layers of the network guard (docs/E2E_TESTING.md). Only the app's exact origin
 * gets through, and the harness fetches those requests itself with redirects refused, since
 * Playwright does not route the requests that follow a redirect in Chromium. Every WebSocket is
 * closed. Routes registered later call route.fallback() for what they do not handle.
 */
export async function guardContext(
  context: BrowserContext,
  origin: string,
  log: BrowserGuardLog,
): Promise<void> {
  await context.routeWebSocket(/.*/, (webSocket) => {
    log.webSockets.push(webSocket.url());
    void webSocket.close();
  });
  await context.route("**/*", (route) => passAppRequest(route, origin, log));
}

async function passAppRequest(route: Route, origin: string, log: BrowserGuardLog): Promise<void> {
  const url = route.request().url();
  if (new URL(url).origin !== origin) {
    log.refused.push(url);
    await route.abort("blockedbyclient");
    return;
  }
  try {
    const response = await route.fetch({
      url: onServerAddress(url),
      // Chromium sends a request again when a kept-alive connection turns out to be closing;
      // route.fetch() does not, so under load a reused connection can end the request.
      headers: { ...(await route.request().allHeaders()), connection: "close" },
      maxRedirects: 0,
    });
    if (response.status() >= 300 && response.status() < 400) {
      log.redirects.push(`${url} -> ${response.headers().location ?? "?"}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ response });
  } catch (error) {
    // Normally the page went away, or the server stopped, while the request was on its way.
    log.fetchFailures.push(`${route.request().method()} ${url}: ${String(error).split("\n")[0]}`);
    await route.abort().catch(() => {});
  }
}

/**
 * The page's URL with the address the server binds. Asked for localhost, the harness's fetch tries
 * [::1] first and can reach another program that listens there on the same port number.
 */
function onServerAddress(url: string): string {
  const target = new URL(url);
  target.hostname = "127.0.0.1";
  return target.href;
}
