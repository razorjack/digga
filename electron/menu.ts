import type { MenuItemConstructorOptions } from "electron";

/** What the menu does in the window; `show` takes a hash route of the client's router. */
export interface MenuActions {
  show(route: string): void;
  /** Opens or closes the page's list of keys, as `?` does. */
  showKeys(): void;
}

export interface MenuOptions {
  platform: NodeJS.Platform;
  /** An unpackaged run, from a terminal: the View menu adds Reload and the developer tools. */
  developer: boolean;
}

/**
 * The app's menus, with Edit for copy and paste in text fields, a View menu for the pages, and a
 * Library menu for the jobs. Each job item opens the Settings tab that starts it, where its
 * progress, its Cancel button and its result already are; starting a job from here would leave
 * the page unaware of it.
 */
export function menuTemplate(
  actions: MenuActions,
  options: MenuOptions,
): MenuItemConstructorOptions[] {
  const library: MenuItemConstructorOptions = {
    label: "Library",
    submenu: [
      { label: "Update the Catalogue…", click: () => actions.show("#/settings/library") },
      { label: "Import from Discogs…", click: () => actions.show("#/settings/discogs") },
      { label: "Back Up…", click: () => actions.show("#/settings/backups") },
    ],
  };
  if (options.platform === "darwin") {
    return [
      appMenu(actions),
      { role: "fileMenu" },
      { role: "editMenu" },
      viewMenu(actions, options.developer),
      library,
      { role: "windowMenu" },
    ];
  }
  return [
    fileMenu(actions),
    { role: "editMenu" },
    viewMenu(actions, options.developer),
    library,
    { role: "windowMenu" },
  ];
}

/** macOS's application menu, with Settings where Mac apps keep it. */
function appMenu(actions: MenuActions): MenuItemConstructorOptions {
  return {
    role: "appMenu",
    submenu: [
      { role: "about" },
      { type: "separator" },
      settingsItem(actions),
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

/** Elsewhere Settings is in the File menu, above Quit. */
function fileMenu(actions: MenuActions): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [settingsItem(actions), { type: "separator" }, { role: "quit" }],
  };
}

function settingsItem(actions: MenuActions): MenuItemConstructorOptions {
  return {
    label: "Settings…",
    accelerator: "CommandOrControl+,",
    click: () => actions.show("#/settings"),
  };
}

/**
 * The pages and the keys, in place of a browser's Reload and developer tools, which only an
 * unpackaged run keeps. The page's own keys (T, W, ?) stay out of the accelerators: a menu
 * accelerator without a modifier would take the key from text fields.
 */
function viewMenu(actions: MenuActions, developer: boolean): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    { label: "Triage", accelerator: "CommandOrControl+1", click: () => actions.show("#/triage") },
    { label: "Twelves", accelerator: "CommandOrControl+2", click: () => actions.show("#/twelves") },
    { type: "separator" },
    { label: "Keys", accelerator: "CommandOrControl+/", click: () => actions.showKeys() },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (developer)
    submenu.push({ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" });
  return { label: "View", submenu };
}
