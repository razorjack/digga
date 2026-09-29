# Electron plan

Packaging recipe against the current code. No Electron dependency exists yet; this documents how
the shell wraps the server without changing it.

## Main process

```ts
// electron/main.ts (session 5)
import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, session } from "electron";
import path from "node:path";
import { createServer } from "../src/server/server.js";
import { loadConfig } from "../src/server/config-file.js";
import { resolvePaths } from "../src/server/paths.js";
import { createLogger } from "../src/server/logger.js";
import {
  dumpLoad,
  importCollection,
  importHistory,
  importWantlist,
} from "../src/server/jobs/index.js";

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  const paths = resolvePaths({ baseDir: userData, distDir: path.join(app.getAppPath(), "dist") });
  const config = loadConfig(paths.configFile); // creates it with defaults on first run
  const secrets = createSafeStorageSecrets(safeStorage, userData); // replaces .env
  const logger = createLogger({ sink: fileSink(path.join(userData, "digga.log")) });
  const server = createServer({ config, paths, secrets, logger });
  const { browserUrl } = await server.start(0, "127.0.0.1"); // free port, localhost only

  session.defaultSession.setUserAgent(CHROME_UA); // YouTube embeds reject Electron's UA
  nativeTheme.themeSource = config.appearance.colorScheme; // "system" | "light" | "dark"
  const win = new BrowserWindow({
    webPreferences: { autoplayPolicy: "no-user-gesture-required", contextIsolation: true },
  });
  await win.loadURL(browserUrl); // http://localhost:port; YouTube refuses some embeds on 127.0.0.1
  Menu.setApplicationMenu(buildMenu(server, paths, win));
  app.on("before-quit", () => void server.stop());
});
```

- `paths` -> `app.getPath('userData')`; nothing else in the server knows where data lives.
- `secrets` -> `safeStorage.encryptString` / `decryptString`, stored as a file under userData. It
  implements the same `Secrets` interface, so the Settings page keeps saving the token through
  `PUT /api/discogs/token`.
- `logger` -> file sink; `createLogger` accepts any `LogSink`.
- `nativeTheme.themeSource` makes `prefers-color-scheme` match the saved color scheme before the
  first paint, so the window does not show the other scheme until `/api/settings` loads. A change
  in Settings applies in the renderer at once and reaches `nativeTheme` on the next start.
- Menu items call the same job functions the CLI uses, and `runWorker()` inside
  `server.jobs.run(...)` for the dump: `dialog.showOpenDialog({ filters: [{ name: "Discogs dump", extensions: ["gz", "xml"] }] })`,
  then `POST /api/jobs/dump-load`-equivalent code with `{ dbFile: paths.dbFile, options }`.
  Progress can be read from `server.jobs.get(id)` or `GET /api/jobs/:id` in the renderer.
- The renderer keeps using `src/client/api.ts` over HTTP. Switching to IPC later means replacing
  `createHttpApi()` in that one file with an IPC implementation of the same `Api` interface.

## Build

- Node inside Electron may not strip TypeScript types. Transpile the server, CLI, worker and shared
  code to JavaScript before packaging (for example `vp pack` / tsdown with entries
  `src/server/server.ts`, `src/server/jobs/dump-load-worker.ts`, `src/cli/digga.ts`), and point the
  Worker URL at the emitted `dump-load-worker.js`. The `.ts` import specifiers are rewritten by the
  bundler; keep the worker as a separate entry so `new Worker(new URL(...))` still resolves.
- `vp build` produces `dist/` with `base: './'`; ship it inside the app and set `distDir`.
- `better-sqlite3` is native: run `@electron/rebuild` (`electron-rebuild -f -w better-sqlite3`)
  against the Electron ABI. `db.ts` is the only import site, so nothing else changes.
- `saxes`, `hono`, `@hono/node-server`, `zod` are pure JS.
- electron-builder targets: mac (dmg, arm64 + x64), win (nsis), linux (AppImage/deb). Include
  `dist/**`, the transpiled server, `digga.config.json` defaults, and `node_modules` with the
  rebuilt native module. Exclude `data/`.
- macOS: hardened runtime, `com.apple.security.cs.allow-unsigned-executable-memory` is not needed,
  but `better-sqlite3` requires the app to be signed with the same identity as the binary; notarize
  with `notarytool` (electron-builder's `afterSign` hook). Windows: code-sign the installer to avoid
  SmartScreen. Linux: none.
- Browser history import: on macOS the packaged app needs Full Disk Access to read Brave's
  `History`; show the hint from `HistoryAccessError` in a dialog.

## What would break each rule

| rule                             | regression to watch for                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Server is a function             | starting the server at module import time, reading argv in `server.ts`, binding to `0.0.0.0`                          |
| One transport seam               | a page or store calling `fetch`, `EventSource` or `WebSocket` directly                                                |
| One place for paths              | `path.resolve('data')`, `__dirname` for user data, `process.cwd()` outside the CLI, `serveStatic({ root: './dist' })` |
| One place for secrets            | `process.env.DISCOGS_TOKEN` read in the client or in a job                                                            |
| Jobs are library functions       | job logic inside a Hono handler or the CLI switch                                                                     |
| Heavy work off the server thread | running the loader inline in a route, synchronous file scans in handlers                                              |
| Frontend environment-agnostic    | `window.location.pathname`, `localStorage` of absolute URLs, `import.meta.env` reads for paths, non-hash routing      |
| Native modules isolated          | importing `better-sqlite3` in an importer or test helper, opening profile files outside `history.ts`                  |
| Logging through logger           | `console.log` in server modules                                                                                       |
| Enforce it                       | skipping `vp run check:portability` before commit                                                                     |
