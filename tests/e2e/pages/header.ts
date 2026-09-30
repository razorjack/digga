import { expect, type Locator } from "@playwright/test";
import { type Route, ROUTES } from "../../../src/client/routes.ts";
import type { DiggaApp } from "../support/app.ts";

/** The header's page, as the routes table lists it. */
export function page(route: Route): { label: string; key: string } {
  const destination = ROUTES.find((candidate) => candidate.route === route);
  if (!destination) throw new Error(`the header has no ${route} page`);
  return destination;
}

/** The app's header: the page links with their keys, the sandbox stamp and the counts. */
export class HeaderPage {
  readonly app: DiggaApp;

  constructor(app: DiggaApp) {
    this.app = app;
  }

  get root(): Locator {
    return this.app.page.getByRole("banner");
  }

  get pages(): Locator {
    return this.root.getByRole("navigation", { name: "Pages" });
  }

  /** Shown while the sandbox is on; it links to the switch in Settings. */
  get sandbox(): Locator {
    return this.root.getByRole("link", { name: /sandbox/i });
  }

  link(route: Route): Locator {
    return this.pages.getByRole("link", { name: page(route).label, exact: true });
  }

  /** The page's key; returns once the header marks that page as the current one. */
  async goTo(route: Route): Promise<void> {
    await expect(this.pages).toBeVisible();
    await this.app.page.keyboard.press(page(route).key.toLowerCase());
    await expect(this.link(route)).toHaveAttribute("aria-current", "page");
  }
}
