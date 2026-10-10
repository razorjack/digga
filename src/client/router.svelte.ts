import { type Route, ROUTES } from "./routes.ts";

/** Hash router. The only place in src/client that reads window.location. */

interface HashLocation {
  route: Route;
  /** A part of the page to point at, such as the tab in `#/settings/library`. */
  anchor: string | null;
}

function parse(hash: string): HashLocation {
  const [name = "", anchor] = hash.replace(/^#\/?/, "").split(/[?]/)[0]!.split("/");
  if (name === "setup") return { route: "setup", anchor: anchor || null };
  return ROUTES.some((r) => r.route === name)
    ? { route: name as Route, anchor: anchor || null }
    : { route: "triage", anchor: null };
}

/**
 * Asked before the app leaves the current page for another; false keeps the page. A page with
 * unsaved work installs one and asks the user itself.
 */
export type LeaveGuard = (route: Route, anchor: string | null) => boolean;

let current = $state<HashLocation>(parse(window.location.hash));
let leaveGuard: LeaveGuard | null = null;

window.addEventListener("hashchange", (event) => {
  const next = parse(window.location.hash);
  // Back and Forward change the hash before anything can ask; staying puts the old one back.
  if (!mayLeaveFor(next)) {
    history.replaceState(history.state, "", event.oldURL);
    return;
  }
  current = next;
});

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  const href = link?.getAttribute("href");
  if (!href?.startsWith("#/")) return;
  if (!mayLeaveFor(parse(href))) event.preventDefault();
});

/** Installs the guard asked before leaving the current page; returns its removal. */
export function guardLeaving(guard: LeaveGuard): () => void {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = null;
  };
}

function mayLeaveFor(next: HashLocation): boolean {
  if (next.route === current.route || !leaveGuard) return true;
  return leaveGuard(next.route, next.anchor);
}

export function getRoute(): Route {
  return current.route;
}

export function getAnchor(): string | null {
  return current.anchor;
}

export function navigate(route: Route, anchor?: string): void {
  if (!mayLeaveFor({ route, anchor: anchor ?? null })) return;
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
