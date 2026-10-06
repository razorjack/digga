# Electron plan

For the test host, preload and release checks, read the [Electron E2E plan](e2e/ELECTRON.md).

Digga runs in an Electron window on macOS, unpackaged, from this repository: `vp run electron:dev`
builds the client and starts `electron .`. The main process wraps the server without changing it,
and the app opens the library the browser version uses. Packaging, signing, notarization and the
Electron E2E host are still to do; see [What is left](#what-is-left).

## Main process

`electron/main.ts` is the entry (`main` in `package.json`, with `productName` "Digga", so
userData is `~/Library/Application Support/Digga`, the default library folder). In order, it:

1. moves Chromium's session data to `userData/Chromium`, so the library folder holds only
   Digga's files (decision 155);
2. reads the environment through `readLaunchEnvironment()` in `src/cli/environment.ts`, the
   CLI's code: `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR`, `DIGGA_CONFIG_FILE`, `DIGGA_LOG_LEVEL`, the
   three service URLs, and a `.env` in the working directory (decision 151);
3. logs to `userData/digga.log` through `createFileSink()`, and to the terminal as well when
   unpackaged;
4. resolves the paths with `resolvePaths()`, loads the config, and creates the secrets with
   `safeStorage` as their encryption (below);
5. calls `createServer({ ..., libraryHolder: "the Digga app" })`, which takes the library lock,
   and starts it on a free port on 127.0.0.1;
6. sets `nativeTheme.themeSource` from the saved colour scheme, so the first paint uses it; a
   change in Settings applies in the renderer at once and reaches `nativeTheme` on the next start;
7. gives the default session Chrome's user agent without the app's and Electron's tokens
   (`electron/user-agent.ts`), since YouTube refuses some embeds to an unknown browser;
8. denies permission requests and sends downloads through a save dialog (`secureSession()`);
9. sets the menu and opens the window at the server's `localhost` address, where YouTube accepts
   the embeds.

Any error before the window opens shows a dialog and quits. When the library lock is held, the
dialog says another Digga is using the library and names the holder from `digga.lock`, such as
"the Digga server (process 4242, since ...)". Electron's single-instance lock is not used
(decision 156).

Quitting waits for `server.stop()` in `before-quit`: running jobs end cancelled, the daily backup
being written finishes, the database closes and the lock is released, and then the app quits.
Closing the window quits, on macOS too. SIGTERM goes the same way, since Chromium handles it as a
quit.

## Window

`electron/window.ts` opens one `BrowserWindow` with `contextIsolation`, `sandbox`, no
`nodeIntegration` and no preload. The renderer is the browser client: it reaches the server over
HTTP through `src/client/api.ts`, and nothing in it knows it runs in Electron. Switching to IPC
later would mean replacing `createHttpApi()` in that one file.

- `window.open` and `target="_blank"` links go to `shell.openExternal` when they are http(s)
  pages elsewhere and are refused otherwise (`electron/links.ts`). The app opens no windows of
  its own.
- Navigation away from the app's origin is refused; an http(s) target opens in the browser.
- Downloads (the exports) ask where to save, starting in Downloads, and the log records where
  they went.
- Every permission request is denied, YouTube's fullscreen included.

## Menu

`electron/menu.ts` builds the standard roles (the File, Edit, View and Window menus; Edit gives
copy and paste in text fields on macOS) and macOS's application menu with Settings… (⌘,). The
Library menu's items open the Settings tab that starts each job instead of starting it there
(decision 157):

| Item                  | Opens                | The tab's jobs                                    |
| --------------------- | -------------------- | ------------------------------------------------- |
| Update the Catalogue… | `#/settings/library` | update, download, load (also from a path)         |
| Import from Discogs…  | `#/settings/discogs` | collection, wantlist, history, Maybe list, seller |
| Back Up…              | `#/settings/backups` | Back up now                                       |

The tab shows the job's progress, Cancel and result, which a job started from the main process
would not reach. Its "From a file" field takes an absolute path, so the dump needs no file dialog.

## Secrets

`createSecrets()` in `src/server/secrets.ts` takes an optional `SecretEncryption`; the app
passes `safeStorage`, as base64 text (decision 152).

- `DISCOGS_TOKEN` in the environment takes precedence, as in the CLI.
- A saved token is `DISCOGS_TOKEN_ENCRYPTED` in the library's `secrets.env` (mode `0600`).
- A token the browser version saved as `DISCOGS_TOKEN` keeps working, and is encrypted when it is
  saved again. Each save replaces both forms.
- Where `safeStorage.isEncryptionAvailable()` is false (Linux without a keyring), the token is
  saved as text in `secrets.env`, as the browser version saves it, and Settings says "saved
  unencrypted".
- The CLI cannot decrypt the encrypted token; its imports then need `DISCOGS_TOKEN`.

## Native module and TypeScript

- `better-sqlite3` 13 is a Node-API addon with prebuilt binaries. Electron 44.5.1 (Node 24.21.0,
  Node-API 10) loads the repository's prebuild in the main process and in the dump-load worker,
  so there is no rebuild and no separate install (decision 153). `db.ts` stays the only import.
- Electron's Node strips types like Node 24, so the main process, the server and the dump-load
  worker run from the `.ts` sources (decision 154).
- `saxes`, `hono`, `@hono/node-server` and `zod` are pure JS.

## Running it

```sh
vp run electron:dev    # vp build, then electron . on the library the browser version uses
```

The environment works as for the CLI, so a throwaway library is
`DIGGA_DATA_DIR=/tmp/digga-try vp run electron:dev`. A shell inside another Electron app (such as
an editor's terminal) may export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node
and fail with "does not provide an export named 'app'"; unset it first. The
[Manual rehearsals](e2e/FIXTURES.md#manual-rehearsals) section and the
[2026-10-06 rehearsal](e2e/HISTORY.md#the-electron-main-process-electron-unpackaged) show how to
start it against the fake services with the guard loaded.

## What is left

- **Packaging** with electron-builder: mac (dmg, arm64 and x64), win (nsis), linux (AppImage or
  deb). Include `dist/**`, `electron/`, `src/`, `tools/dump/` (the loader the worker imports),
  `src/server/db/migrations/` and `node_modules` with the better-sqlite3 prebuild for each
  target. Exclude `data/`; a new config starts from the schema defaults. Set `distDir` from
  `app.getAppPath()` if the default, two folders above `src/server/`, stops matching.
- **TypeScript in a packaged app.** Node does not strip types from files under `node_modules`,
  and loading `.ts` from an asar archive is untested. If either fails, transpile the main process,
  server, worker and shared code to JavaScript (for example `vp pack` or tsdown, with
  `electron/main.ts`, `src/server/jobs/dump-load-worker.ts`, `src/server/decisions-backup-worker.ts`
  and `src/cli/digga.ts` as entries), keep each worker a separate entry so
  `new Worker(new URL(...))` resolves, and point the URLs at the emitted `.js` files. Unpacking
  the workers (`asarUnpack`) is the other option.
- **Native module per platform.** Check that the prebuild loads in the packaged app on each
  target, and that signing covers it.
- **macOS:** hardened runtime; sign everything with one identity, the better-sqlite3 binary
  included; notarize with `notarytool` (electron-builder's `afterSign` hook). Windows: sign the
  installer to avoid SmartScreen. Linux: none.
- **Fuses** for the release build, and an inspectable variant for the E2E suite
  ([Electron E2E plan](e2e/ELECTRON.md#launch-and-release-builds)).
- **Browser history import:** on macOS the packaged app needs Full Disk Access to read Brave's
  `History`; show the hint from `HistoryAccessError` in a dialog.
- **The setup's Electron parts** ([FIRST_RUN](FIRST_RUN.md#electron)): load progress on the Dock
  icon, a notification when a load finishes unseen, `powerSaveBlocker` during a download or
  load, asking before quitting during a download, "Use a dump file I have" with a file dialog, and
  a folder picker when there is too little space.
- **Logs.** `digga.log` grows without rotation. The dump-load and backup workers log to their
  own console, which an unpackaged run prints and a packaged app loses; forwarding their lines to
  the main process's logger is left for packaging.
- **The Electron E2E host and ELEC scenarios**, and running on Windows and Linux.
- **Auto-update.**

## What would break each rule

| rule                             | regression to watch for                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Server is a function             | starting the server at module import time, reading argv in `server.ts`, binding to `0.0.0.0`                          |
| One transport seam               | a page or store calling `fetch`, `EventSource` or `WebSocket` directly                                                |
| One place for paths              | `path.resolve('data')`, `__dirname` for user data, `process.cwd()` outside the CLI, `serveStatic({ root: './dist' })` |
| One place for secrets            | `process.env.DISCOGS_TOKEN` read in the client, a job or `electron/`                                                  |
| Jobs are library functions       | job logic inside a Hono handler, the CLI switch or a menu item                                                        |
| Heavy work off the server thread | running the loader inline in a route, synchronous file scans in handlers                                              |
| Frontend environment-agnostic    | `window.location.pathname`, `localStorage` of absolute URLs, `import.meta.env` reads for paths, non-hash routing      |
| Native modules isolated          | importing `better-sqlite3` in an importer or test helper, opening profile files outside `history.ts`                  |
| Logging through logger           | `console.log` in server modules or `electron/`                                                                        |
| Server free of Electron          | an `electron` import in `src/`, `tools/` or `scripts/`                                                                |
| Enforce it                       | skipping `vp run check:portability` before commit                                                                     |
