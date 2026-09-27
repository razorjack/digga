/** Hash router. The only place in src/client that reads window.location. */
export type Route = "triage" | "twelves" | "settings";

export const ROUTES: { route: Route; label: string }[] = [
  { route: "triage", label: "Triage" },
  { route: "twelves", label: "Twelves" },
  { route: "settings", label: "Settings" },
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
