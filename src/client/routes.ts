/** The app's pages, as the hash names them. */
export type Route = "triage" | "twelves" | "settings" | "setup";

/** The pages in the header, with their keys; the setup is reached from the app, not the header. */
export const ROUTES: { route: Route; label: string; key: string }[] = [
  { route: "triage", label: "Triage", key: "T" },
  { route: "twelves", label: "Twelves", key: "W" },
  { route: "settings", label: "Settings", key: "," },
];
