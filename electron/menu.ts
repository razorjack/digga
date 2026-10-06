import type { MenuItemConstructorOptions } from "electron";

/** What the menu does in the window; `show` takes a hash route of the client's router. */
export interface MenuActions {
  show(route: string): void;
}

/**
 * The standard menus, with Edit for copy and paste in text fields, and a Library menu for the
 * jobs. Each job item opens the Settings tab that starts it, where its progress, its Cancel button
 * and its result already are; starting a job from here would leave the page unaware of it.
 */
export function menuTemplate(
  actions: MenuActions,
  platform: NodeJS.Platform,
): MenuItemConstructorOptions[] {
  const library: MenuItemConstructorOptions = {
    label: "Library",
    submenu: [
      { label: "Update the Catalogue…", click: () => actions.show("#/settings/library") },
      { label: "Import from Discogs…", click: () => actions.show("#/settings/discogs") },
      { label: "Back Up…", click: () => actions.show("#/settings/backups") },
    ],
  };
  const menus: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    library,
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  if (platform === "darwin") menus.unshift(appMenu(actions));
  return menus;
}

/** macOS's application menu, with Settings where Mac apps keep it. */
function appMenu(actions: MenuActions): MenuItemConstructorOptions {
  return {
    role: "appMenu",
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CommandOrControl+,",
        click: () => actions.show("#/settings"),
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };
}
