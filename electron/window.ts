import { app, BrowserWindow, type Session, shell } from "electron";
import path from "node:path";
import type { Logger } from "../src/server/logger.ts";
import { linkTarget } from "./links.ts";

/**
 * The window shows the app's own pages only. It has no Node and no preload: the renderer is the
 * browser client and reaches the server over HTTP. Links elsewhere open in the user's browser.
 */
export async function openWindow(url: string, logger: Logger): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Digga",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  keepToApp(window, new URL(url).origin, logger);
  // localhost, not 127.0.0.1: YouTube refuses some embeds on IP-address origins.
  await window.loadURL(url);
  return window;
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
