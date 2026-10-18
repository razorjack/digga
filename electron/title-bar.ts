import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from "electron";

/**
 * Where the window's title bar comes from (docs/ELECTRON_PLAN.md#title-bar-on-windows-and-linux).
 * On macOS, and on Linux under KDE Plasma and GNOME, the page's toolbar is the title bar: the
 * window hides the system's and draws its buttons over the toolbar, which keeps clear of them
 * through the Window Controls Overlay's CSS variables and drags the window by its empty space.
 * Other desktops keep the system's title bar; a tiling window manager draws none, and the window
 * would show buttons it has no use for.
 */

export interface WindowSystem {
  platform: NodeJS.Platform;
  /** XDG_CURRENT_DESKTOP's names (src/cli/environment.ts). */
  currentDesktop: string[];
}

/** The toolbar's height (`.top` in App.svelte), which the window's buttons are centred on. */
const TOOLBAR_HEIGHT = 52;
/** `--fg` in styles.css, by scheme. */
const BUTTON_SYMBOL = { dark: "#ebe5d4", light: "#1c1a15" };
/** Transparent, so the toolbar shows under the buttons, its bottom rule included. */
const BUTTON_GROUND = "#00000000";
/** Desktops whose own apps put their controls in the title bar, as Digga's toolbar does. */
const DESKTOPS_WITH_HEADER_BARS = new Set(["KDE", "GNOME"]);

export function titleBarOptions(
  system: WindowSystem,
  dark: boolean,
): BrowserWindowConstructorOptions {
  // macOS draws the traffic lights itself, centred here on the toolbar.
  if (system.platform === "darwin")
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: true,
      trafficLightPosition: { x: 20, y: 19 },
    };
  if (!drawsButtonsOverToolbar(system)) return {};
  return { titleBarStyle: "hidden", titleBarOverlay: buttonOverlay(dark) };
}

/** Linux under KDE Plasma or GNOME, where Electron draws the window's buttons in the given colours. */
export function drawsButtonsOverToolbar(system: WindowSystem): boolean {
  return (
    system.platform === "linux" &&
    system.currentDesktop.some((name) => DESKTOPS_WITH_HEADER_BARS.has(name))
  );
}

/** The buttons for the scheme in use; the window takes them again when the scheme changes. */
export function buttonOverlay(dark: boolean): TitleBarOverlayOptions {
  return {
    color: BUTTON_GROUND,
    symbolColor: dark ? BUTTON_SYMBOL.dark : BUTTON_SYMBOL.light,
    height: TOOLBAR_HEIGHT,
  };
}
