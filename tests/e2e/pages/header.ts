import { expect, type Locator } from "@playwright/test";
import { type Route, ROUTES } from "../../../src/client/routes.ts";
import type { DiggaApp } from "../support/app.ts";

/** The toolbar's page, as the routes table lists it. */
export function page(route: Route): { label: string; key: string } {
  const destination = ROUTES.find((candidate) => candidate.route === route);
  if (!destination) throw new Error(`the toolbar has no ${route} page`);
  return destination;
}

/** The app's toolbar: the page links and Settings with their keys, and the counts. */
export class HeaderPage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("banner");
  }

  /** Triage and Twelves; Settings has its own link at the toolbar's end. */
  get pages(): Locator {
    return this.root.getByRole("navigation", { name: "Pages" });
  }

  /** "loading 41%" while a load runs, "fetching" while only a download does. */
  get loadIndicator(): Locator {
    return this.root.getByRole("link", { name: /^(loading|fetching)\b/ });
  }

  /** Says once that the catalogue is in when a load this tab watched has finished. */
  get announcement(): Locator {
    return this.root.getByRole("status");
  }

  link(route: Route): Locator {
    return this.root.getByRole("link", { name: page(route).label, exact: true });
  }

  /** The page's key; returns once the toolbar marks that page as the current one. */
  async goTo(route: Route): Promise<void> {
    await expect(this.pages).toBeVisible();
    await this.app.page.keyboard.press(page(route).key.toLowerCase());
    await expect(this.link(route)).toHaveAttribute("aria-current", "page");
  }
}
