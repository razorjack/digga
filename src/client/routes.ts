/** The app's pages, as the hash names them. */
export type Route = "triage" | "twelves" | "settings" | "setup";

/** A page the toolbar reaches, with its key. */
export interface Destination {
  route: Route;
  label: string;
  key: string;
}

/** The pages the toolbar switches between; the setup is reached from the app, not the toolbar. */
export const PAGES: Destination[] = [
  { route: "triage", label: "Triage", key: "T" },
  { route: "twelves", label: "Twelves", key: "W" },
];

/** Settings has its own button at the toolbar's end, where apps keep it. */
export const SETTINGS: Destination = { route: "settings", label: "Settings", key: "," };

/** Every page with a key. */
export const ROUTES: Destination[] = [...PAGES, SETTINGS];
