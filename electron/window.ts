import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  nativeTheme,
  type Rectangle,
  screen,
  type Session,
  shell,
} from "electron";
import path from "node:path";
import type { Logger } from "../src/server/logger.ts";
import { linkTarget } from "./links.ts";
import { reachableBounds, readWindowState, saveWindowState } from "./window-state.ts";

export interface WindowOptions {
  /** The server's localhost address. */
  url: string;
  logger: Logger;
  /** Where the window's size and position are kept between starts. */
  stateFile: string;
}

const DEFAULT_SIZE = { width: 1440, height: 900 };
/** Wide enough that Triage keeps its two columns and the toolbar one row (the page stacks below 980 px). */
const MINIMUM_SIZE = { width: 1080, height: 680 };
/** The page's ground (--bg in styles.css), so the window shows no white before the first paint. */
const GROUND = { dark: "#161618", light: "#eee9dc" };

/**
 * The window shows the app's own pages only. It has no Node and no preload: the renderer is the
 * browser client and reaches the server over HTTP. Links elsewhere open in the user's browser.
 */
export async function openWindow({
  url,
  logger,
  stateFile,
}: WindowOptions): Promise<BrowserWindow> {
  const saved = readWindowState(stateFile);
  const window = new BrowserWindow({
    ...windowBounds(saved?.bounds ?? null),
    minWidth: MINIMUM_SIZE.width,
    minHeight: MINIMUM_SIZE.height,
    show: false,
    title: "Digga",
    backgroundColor: nativeTheme.shouldUseDarkColors ? GROUND.dark : GROUND.light,
    ...titleBarOptions(process.platform),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (saved?.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());
  window.on("close", () => {
    const state = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
    saveWindowState(stateFile, state, logger);
  });
  keepToApp(window, new URL(url).origin, logger);
  // localhost, not 127.0.0.1: YouTube refuses some embeds on IP-address origins.
  await window.loadURL(url);
  return window;
}

/** The saved bounds while a display still shows the window, else the default size, centred. */
function windowBounds(saved: Rectangle | null): Partial<Rectangle> {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const reachable = saved ? reachableBounds(saved, workAreas, MINIMUM_SIZE) : null;
  return reachable ?? DEFAULT_SIZE;
}

/**
 * On macOS the app's toolbar is the title bar: the traffic lights sit in it, centred on its
 * 52 px, and the overlay gives the page the CSS variables that keep the toolbar clear of them.
 * Windows and Linux keep the system's title bar for now (docs/ELECTRON_PLAN.md#title-bar-on-windows-and-linux).
 */
function titleBarOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform !== "darwin") return {};
  return { titleBarStyle: "hidden", titleBarOverlay: true, trafficLightPosition: { x: 20, y: 19 } };
}

/** No page gets a permission it asks for, and every download asks where to save. */
export function secureSession(session: Session, logger: Logger): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.debug(`denied the page's request for ${permission}`);
    callback(false);
  });
  session.on("will-download", (_event, item) => {
    // Without a save path Electron asks the user where to save, starting here.
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
    item.once("done", (_doneEvent, state) => {
      logger.info(
        `download of ${item.getFilename()} ${state}: ${item.getSavePath() || "not saved"}`,
      );
    });
  });
}

/** New windows and navigation away from the app go to the user's browser, or nowhere. */
function keepToApp(window: BrowserWindow, appOrigin: string, logger: Logger): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url, appOrigin, logger);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => {
    if (linkTarget(event.url, appOrigin) === "app") return;
    event.preventDefault();
    openOutside(event.url, appOrigin, logger);
  });
}

function openOutside(url: string, appOrigin: string, logger: Logger): void {
  if (linkTarget(url, appOrigin) !== "external") {
    logger.warn(`refused to open ${url}`);
    return;
  }
  logger.info(`opening ${url} in the browser`);
  shell.openExternal(url).catch((error: unknown) => logger.warn(`could not open ${url}`, error));
}
