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
 * Chromium's switch for the browser and the Electron app: no host name but localhost resolves, so
 * what the routes never see, such as a preconnect or electron.net, goes nowhere. 127.0.0.1 stays
 * resolvable for the scenario that opens the app there; the routes allow only the app's port.
 */
export const HOST_RESOLVER_RULES =
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1";

/** The guard of one context, which lets nothing through until it knows the app's origin. */
export interface ContextGuard {
  allowOrigin(origin: string): void;
}

/**
 * The browser's layers of the network guard (docs/e2e/HARNESS.md#the-network-and-filesystem-guard).
 * Only the app's exact origin, and the same server on 127.0.0.1 (SHELL-06), gets through, and the
 * harness fetches those requests itself with redirects refused, since
 * Playwright does not route the requests that follow a redirect in Chromium. Every WebSocket is
 * closed. Routes registered later call route.fallback() for what they do not handle. The Electron
 * host installs the guard before its server has a port, so the origin is allowed afterwards.
 */
export async function guardContext(
  context: BrowserContext,
  log: BrowserGuardLog,
): Promise<ContextGuard> {
  await context.routeWebSocket(/.*/, (webSocket) => {
    log.webSockets.push(webSocket.url());
    void webSocket.close();
  });
  const allowed = new Set<string>();
  await context.route("**/*", (route) => passAppRequest(route, allowed, log));
  return {
    allowOrigin(origin) {
      for (const appOrigin of appOrigins(origin)) allowed.add(appOrigin);
    },
  };
}

/** The app's origin, and the same port on the address the server binds, where the app warns. */
function appOrigins(origin: string): string[] {
  const address = new URL(origin);
  address.hostname = "127.0.0.1";
  return [origin, address.origin];
}

async function passAppRequest(
  route: Route,
  allowed: Set<string>,
  log: BrowserGuardLog,
): Promise<void> {
  const url = route.request().url();
  if (!allowed.has(new URL(url).origin)) {
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
