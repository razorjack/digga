import { type Route, ROUTES } from "./routes.ts";

/** Hash router. The only place in src/client that reads window.location. */

interface HashLocation {
  route: Route;
  /** A part of the page to point at: `#/settings/sandbox` highlights the sandbox setting. */
  anchor: string | null;
}

function parse(hash: string): HashLocation {
  const [name = "", anchor] = hash.replace(/^#\/?/, "").split(/[?]/)[0]!.split("/");
  if (name === "setup") return { route: "setup", anchor: anchor || null };
  return ROUTES.some((r) => r.route === name)
    ? { route: name as Route, anchor: anchor || null }
    : { route: "triage", anchor: null };
}

let current = $state<HashLocation>(parse(window.location.hash));

window.addEventListener("hashchange", () => {
  current = parse(window.location.hash);
});

export function getRoute(): Route {
  return current.route;
}

export function getAnchor(): string | null {
  return current.anchor;
}

export function navigate(route: Route, anchor?: string): void {
  window.location.hash = anchor ? `#/${route}/${anchor}` : `#/${route}`;
}

/**
 * YouTube refuses some embeds on IP-address origins, so the app should run on localhost.
 * Returns the localhost address of this page when it was opened on 127.0.0.1, else null.
 */
export function localhostAlternative(): string | null {
  const { hostname, port, hash } = window.location;
  if (hostname !== "127.0.0.1" && hostname !== "[::1]") return null;
  return `http://localhost${port ? `:${port}` : ""}/${hash}`;
}

/** Opens an external page (Discogs, YouTube search) outside the app. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
