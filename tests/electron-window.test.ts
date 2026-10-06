import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vite-plus/test";
import { linkTarget } from "../electron/links.ts";
import { menuTemplate } from "../electron/menu.ts";

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
