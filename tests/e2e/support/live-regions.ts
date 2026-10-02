import type { Page } from "@playwright/test";

declare global {
  interface Window {
    /** Live regions the page inserted with their text already in them, as "role: text". */
    __liveRegionsInsertedWithText?: string[];
  }
}

/**
 * Screen readers announce changes inside a live region that is already in the page, and may say
 * nothing of a region inserted together with its text (docs/e2e/AUTHORING.md#markup-audit).
 * The watch records every live region inserted holding text, from the page's first script on.
 */
export class LiveRegionWatch {
  readonly #page: Page;

  private constructor(page: Page) {
    this.#page = page;
  }

  /** Call before the page opens: the script runs before the app's first one on every load. */
  static async install(page: Page): Promise<LiveRegionWatch> {
    await page.addInitScript(watchLiveRegions);
    return new LiveRegionWatch(page);
  }

  /** "alert: …" or "status: …" for each live region inserted with its text, in order. */
  insertedWithText(): Promise<string[]> {
    return this.#page.evaluate(() => [...(window.__liveRegionsInsertedWithText ?? [])]);
  }
}

/** Runs in the page before any of its scripts, so it sees the first regions the app inserts. */
function watchLiveRegions(): void {
  const selector = '[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])';
  const found: string[] = [];
  window.__liveRegionsInsertedWithText = found;
  const textOf = (region: Element) => (region.textContent ?? "").replace(/\s+/g, " ").trim();
  const regionsIn = (node: Node): Element[] => {
    if (!(node instanceof Element)) return [];
    return [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
  };
  const observer = new MutationObserver((mutations) => {
    const added = mutations.flatMap((mutation) => [...mutation.addedNodes].flatMap(regionsIn));
    for (const region of added)
      if (textOf(region) !== "")
        found.push(`${region.getAttribute("role") ?? "live"}: ${textOf(region)}`);
  });
  observer.observe(document, { childList: true, subtree: true });
}
