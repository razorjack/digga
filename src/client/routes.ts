/** The app's pages, as the hash names them. */
export type Route = "triage" | "twelves" | "settings" | "setup" | "shop";

/** A page the toolbar reaches, with its key. */
export interface Destination {
  route: Route;
  label: string;
  key: string;
  /** What the Keys dialog says the key opens. */
  help: string;
}

/** The pages the toolbar switches between; the setup is reached from the app, not the toolbar. */
export const PAGES: Destination[] = [
  { route: "triage", label: "Triage", key: "T", help: "triage" },
  { route: "twelves", label: "Twelves", key: "W", help: "twelves" },
  { route: "shop", label: "Shop", key: "H", help: "shop my wants" },
];

/** Settings has its own button at the toolbar's end, where apps keep it. */
export const SETTINGS: Destination = {
  route: "settings",
  label: "Settings",
  key: ",",
  help: "settings",
};

/** Every page with a key. */
export const ROUTES: Destination[] = [...PAGES, SETTINGS];
