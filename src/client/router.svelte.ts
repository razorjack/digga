/** Hash router. The only place in src/client that reads window.location. */
export type Route = "triage" | "twelves" | "settings";

export const ROUTES: { route: Route; label: string; key: string }[] = [
  { route: "triage", label: "Triage", key: "T" },
  { route: "twelves", label: "Twelves", key: "W" },
  { route: "settings", label: "Settings", key: "," },
];

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return ROUTES.some((r) => r.route === name) ? (name as Route) : "triage";
}

let current = $state<Route>(parse(window.location.hash));

window.addEventListener("hashchange", () => {
  current = parse(window.location.hash);
});

export function getRoute(): Route {
  return current;
}

export function navigate(route: Route): void {
  window.location.hash = `#/${route}`;
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
