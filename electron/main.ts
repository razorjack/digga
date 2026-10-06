import { app, BrowserWindow, dialog, nativeTheme, safeStorage, session } from "electron";
import path from "node:path";
import { readLaunchEnvironment } from "../src/cli/environment.ts";
import { loadConfig } from "../src/server/config-file.ts";
import { LibraryInUseError } from "../src/server/library-lock.ts";
import {
  consoleSink,
  createFileSink,
  createLogger,
  type Logger,
  type LogSink,
} from "../src/server/logger.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { createSecrets, type SecretEncryption } from "../src/server/secrets.ts";
import { createServer, type DiggaServer } from "../src/server/server.ts";
import { chromeUserAgent } from "./user-agent.ts";

/**
 * The Electron app: the server the CLI's `serve` starts, on a free port, in a window. The
 * renderer is the same client as in a browser and talks to the server over HTTP only.
 */

// The library is in the userData folder by default; Chromium's own files stay out of it.
app.setPath("sessionData", path.join(app.getPath("userData"), "Chromium"));

app
  .whenReady()
  .then(startDigga)
  .catch(async (error: unknown) => {
    await showStartupError(error);
    app.quit();
  });

async function startDigga(): Promise<void> {
  const environment = readLaunchEnvironment();
  const logger = createLogger({ level: environment.logLevel, sink: logSink() });
  const paths = resolvePaths(environment.paths);
  const config = loadConfig(paths.configFile);
  const secrets = createSecrets({
    envFile: paths.secretsFile,
    encryption: safeStorageEncryption(),
  });
  const server = createServer({
    config,
    paths,
    secrets,
    logger,
    libraryHolder: "the Digga app",
    ...environment.services,
  });
  stopServerBeforeQuit(server, logger);

  const { browserUrl } = await server.start(0, "127.0.0.1");
  logger.info(`library: ${paths.dataDir}, dumps: ${paths.dumpsDir}`);

  nativeTheme.themeSource = config.appearance.colorScheme;
  session.defaultSession.setUserAgent(chromeUserAgent(session.defaultSession.getUserAgent()));
  await openWindow(browserUrl);
}

/** The log in userData; an unpackaged run, started from a terminal, prints it there too. */
function logSink(): LogSink {
  const file = createFileSink(path.join(app.getPath("userData"), "digga.log"));
  if (app.isPackaged) return file;
  return {
    write(level, scope, message, data) {
      file.write(level, scope, message, data);
      consoleSink.write(level, scope, message, data);
    },
  };
}

/** The Keychain on macOS, DPAPI on Windows, and a keyring on Linux when there is one. */
function safeStorageEncryption(): SecretEncryption {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, "base64")),
  };
}

/** Quitting waits for the server to stop, so running jobs end cancelled and the database closes. */
function stopServerBeforeQuit(server: DiggaServer, logger: Logger): void {
  let stopped = false;
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    void server
      .stop()
      .catch((error: unknown) => logger.error("the server did not stop cleanly", error))
      .finally(() => {
        stopped = true;
        app.quit();
      });
  });
}

async function openWindow(url: string): Promise<void> {
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
  // localhost, not 127.0.0.1: YouTube refuses some embeds on IP-address origins.
  await window.loadURL(url);
}

async function showStartupError(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  const message =
    error instanceof LibraryInUseError
      ? "Another Digga is using the library."
      : "Digga could not start.";
  await dialog.showMessageBox({ type: "error", message, detail });
}
