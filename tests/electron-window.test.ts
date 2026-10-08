import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vite-plus/test";
import { linkTarget } from "../electron/links.ts";
import { menuTemplate } from "../electron/menu.ts";
import { parseWindowState, reachableBounds } from "../electron/window-state.ts";

const APP = "http://localhost:51234";

describe("links in the window", () => {
  it("keeps the app's own pages, sends http(s) elsewhere to the browser, and opens nothing else", () => {
    expect(linkTarget(`${APP}/#/settings/discogs`, APP)).toBe("app");
    expect(linkTarget(`${APP}/api/export/verdicts.csv`, APP)).toBe("app");
    expect(linkTarget("https://www.discogs.com/release/1201", APP)).toBe("external");
    expect(linkTarget("http://localhost:3456/", APP)).toBe("external");
    expect(linkTarget("http://127.0.0.1:51234/", APP)).toBe("external");
    expect(linkTarget("file:///etc/passwd", APP)).toBe("other");
    expect(linkTarget("javascript:alert(1)", APP)).toBe("other");
    expect(linkTarget("not a url", APP)).toBe("other");
  });
});

describe("the menu", () => {
  const shown: string[] = [];
  const template = menuTemplate({ show: (route) => shown.push(route) }, "darwin");
  const submenu = (label: string) =>
    template.find((menu) => menu.label === label)?.submenu as MenuItemConstructorOptions[];
  const click = (item: MenuItemConstructorOptions | undefined) =>
    (item?.click as (() => void) | undefined)?.();

  it("has the standard menus, Edit among them for copy and paste in text fields", () => {
    expect(template.map((menu) => menu.role ?? menu.label)).toEqual([
      "appMenu",
      "fileMenu",
      "editMenu",
      "Library",
      "viewMenu",
      "windowMenu",
    ]);
    expect(
      menuTemplate({ show: () => {} }, "linux").map((menu) => menu.role ?? menu.label),
    ).toEqual(["fileMenu", "editMenu", "Library", "viewMenu", "windowMenu"]);
  });

  it("opens the Settings tab that starts each job, and Settings itself from the app menu", () => {
    for (const item of submenu("Library")) click(item);
    const appMenu = template[0]!.submenu as MenuItemConstructorOptions[];
    click(appMenu.find((item) => item.label === "Settings…"));

    expect(shown).toEqual([
      "#/settings/library",
      "#/settings/discogs",
      "#/settings/backups",
      "#/settings",
    ]);
  });
});

describe("the window's size and place", () => {
  const display = { x: 0, y: 0, width: 1512, height: 944 };
  const minimum = { width: 1080, height: 680 };

  it("reads only a state the app wrote", () => {
    const bounds = { x: 10, y: 40, width: 1200, height: 800 };
    expect(parseWindowState({ bounds, maximized: true })).toEqual({ bounds, maximized: true });
    expect(parseWindowState({ bounds, maximized: "yes" })).toBeNull();
    expect(parseWindowState({ bounds: { ...bounds, width: "1200" }, maximized: false })).toBeNull();
    expect(parseWindowState(null)).toBeNull();
  });

  it("restores the bounds while a display shows the window's top edge, at least the minimum size", () => {
    expect(
      reachableBounds({ x: 100, y: 50, width: 1200, height: 800 }, [display], minimum),
    ).toEqual({
      x: 100,
      y: 50,
      width: 1200,
      height: 800,
    });
    expect(reachableBounds({ x: 100, y: 50, width: 600, height: 400 }, [display], minimum)).toEqual(
      {
        x: 100,
        y: 50,
        width: 1080,
        height: 680,
      },
    );
  });

  it("forgets bounds on a display that is gone or with the top edge out of reach", () => {
    expect(
      reachableBounds({ x: 2000, y: 50, width: 1200, height: 800 }, [display], minimum),
    ).toBeNull();
    expect(
      reachableBounds({ x: 1450, y: 50, width: 1200, height: 800 }, [display], minimum),
    ).toBeNull();
    expect(
      reachableBounds({ x: 100, y: -500, width: 1200, height: 800 }, [display], minimum),
    ).toBeNull();
    const external = { x: 1512, y: 0, width: 2560, height: 1440 };
    expect(
      reachableBounds({ x: 2000, y: 50, width: 1200, height: 800 }, [display, external], minimum),
    ).not.toBeNull();
  });
});
