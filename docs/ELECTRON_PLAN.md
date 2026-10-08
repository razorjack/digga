# Electron plan

For the test host, preload and release checks, read the [Electron E2E plan](e2e/ELECTRON.md).

Digga runs in an Electron window on macOS, from this repository with `vp run electron:dev`, which
builds the client and starts `electron .`, or packaged with `vp run electron:package`, an ad-hoc
signed app and dmg for Apple silicon ([Packaging](#packaging)). The main process wraps the server
without changing it, and the app opens the library the browser version uses. The E2E suite runs
on it (`vp run e2e:electron`). [What is left](#what-is-left) lists the rest.

## Main process

`electron/main.ts` is the entry (`main` in `package.json`, with `productName` "Digga", so
userData is `~/Library/Application Support/Digga`, the default library folder). In order, it:

1. moves Chromium's session data to `userData/Chromium`, so the library folder holds only
   Digga's files (decision 155), and with `DIGGA_E2E_HOLD=1` then waits for the E2E host to
   prepare it (decision 162, [The packaged app](e2e/ELECTRON.md#the-packaged-app));
2. reads the environment through `readLaunchEnvironment()` in `src/cli/environment.ts`, the
   CLI's code: `DIGGA_DATA_DIR`, `DIGGA_DUMPS_DIR`, `DIGGA_CONFIG_FILE`, `DIGGA_LOG_LEVEL`, the
   three service URLs, and a `.env` in the working directory (decision 151);
3. logs to `userData/digga.log` through `createFileSink()`, and to the terminal as well when
   unpackaged. A log over 10 MB at the start becomes `digga.log.1`, replacing the one there. The
   dump-load and backup workers log through `workerLogger()`, which posts each line to the main
   process's logger, so their lines reach the log of a packaged app too (decision 164);
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
- A saved token that `safeStorage` cannot decrypt counts as none, and Settings asks for it: an
  ad-hoc signature changes with every build, so macOS asks whether the new build may read the
  "Digga Safe Storage" Keychain item, and the user may decline. The token is read once per start,
  so a refusal does not repeat the question for each request, and the library is not touched.
  The next save replaces the encrypted token, encrypted again when `safeStorage` can encrypt and
  as text otherwise. `tests/setup-http.test.ts` covers both. What a declined prompt does to
  `safeStorage.isEncryptionAvailable()` is unverified: the owner checks the prompt across two
  builds.

## Native module and TypeScript

- `better-sqlite3` 13 is a Node-API addon with prebuilt binaries. Electron 44.5.1 (Node 24.21.0,
  Node-API 10) loads the repository's prebuild in the main process and in the dump-load worker,
  so there is no rebuild and no separate install (decision 153). `db.ts` stays the only import.
- Electron's Node strips types like Node 24, so the main process, the server and both workers
  run from the `.ts` sources (decision 154), in the packaged app too, from inside `app.asar`
  (decision 160).
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

## Packaging

`vp run electron:package` builds the client and runs `scripts/package-electron.ts`, which calls
electron-builder's `build()` with its configuration in the script (decision 159), once for each
variant, and then the release build's health check, `scripts/electron-health-check.ts`
([Electron E2E plan](e2e/ELECTRON.md#product-integration-requirements)):

- the release build: `release/Digga-<version>-arm64.dmg` and the app in
  `release/mac-arm64/Digga.app`;
- the inspectable variant, which the E2E suite runs on: `release/inspectable/mac-arm64/Digga.app`,
  with no dmg. It differs from the release build only in the inspect-arguments fuse; both have the
  same `app.asar`.

- **Contents.** `app.asar` holds `package.json` (whose `main` is still `electron/main.ts`),
  `dist/`, `electron/`, `src/` without `src/client/` (the migrations and the shipped style census
  included), `tools/dump/` and the production dependencies. better-sqlite3 goes without its
  sources and with only `prebuilds/darwin-arm64.node`, and electron-builder unpacks the package
  into `app.asar.unpacked`, since a native module cannot load from an archive. `data/` and the
  tests stay out; a new config starts from the schema defaults.
- **TypeScript.** The main process, the server and both workers run from the `.ts` files inside
  `app.asar`, with no transpile step (decision 160). `distDir`'s default, two folders above
  `src/server/`, is `app.asar/dist`, which the static handler reads through Electron's archive
  support.
- **No rebuild.** `npmRebuild` is off: the repository's prebuild loads in Electron (decision
  153), and a rebuild would replace the binary the CLI, vitest and the web suite load.
- **Fuses** (decision 161), flipped by electron-builder before it signs: `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` off,
  `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation` on; the inspectable variant
  keeps `EnableNodeCliInspectArguments` on. The others keep Electron's defaults. The release
  build ignores `--inspect`, and neither variant honours `-r`. Integrity covers `app.asar` only:
  a changed byte in it stops the app ("ASAR Integrity Violation"), while a changed file in
  `app.asar.unpacked` still runs, and only the signature's seal notices it.
- **Signing.** Ad-hoc (`identity: "-"`), the native module included, with no hardened runtime
  and no notarization (decision 158). `codesign --verify --deep --strict` accepts the app.
- **Architecture.** arm64 only. An x64 build costs one more target, but Rosetta is not installed
  on the Mac that builds it, so it could not be started there (decision 159).
- **Size.** The app is about 250 MB, the dmg about 118 MB; Electron's framework is most of it.
  Only the English locale is kept. There is no icon yet; the app has Electron's.

**Gatekeeper.** A downloaded copy carries `com.apple.quarantine`, and Gatekeeper refuses it:
`spctl --assess --verbose` answers "rejected" for the app (also without the attribute), and
"rejected, source=no usable signature" for the dmg, which is not signed. `syspolicy_check
distribution` names the ad-hoc signature and the missing notarization ticket. A user opens it
through "Open Anyway" in System Settings > Privacy & Security, or removes the attribute with
`xattr -dr com.apple.quarantine`; the README has the steps, as a draft until the owner has seen
the dialogs.

Never open a packaged build from Finder or with `open` while testing: with `productName` "Digga"
it runs on the owner's library. Start it with `--user-data-dir` and every `DIGGA_*` path in a
throwaway folder.

## What is left

Before the first release:

- **The owner's checks** on a downloaded copy: the Gatekeeper dialogs and the README's install
  steps, which are a draft until then, and the Keychain prompt after a second build, declined and
  allowed (decision 158).
- **A version and an icon.** `package.json` says `0.0.0`, which names the dmg, and the app and
  the dmg have Electron's icon.
- **The ×10 burn-in** of the Electron configuration on a quiet machine ([PLAN](e2e/PLAN.md#electron)).

Later:

- **Other packages:** x64 for Intel Macs (one more target, once a Mac with Rosetta or an Intel
  Mac can start it), win (nsis, signed only through a free service, if one qualifies), linux
  (AppImage or deb), each with its better-sqlite3 prebuild, checked to load in the packaged app,
  and the E2E suite on each. Node does not strip types from files under `node_modules`, which
  matters only if the app moves there.
- **Browser history import:** on macOS the packaged app needs Full Disk Access to read Brave's
  `History`; show the hint from `HistoryAccessError` in a dialog (ELEC-12).
- **The setup's Electron parts** ([FIRST_RUN](FIRST_RUN.md#electron)): load progress on the Dock
  icon, a notification when a load finishes unseen, `powerSaveBlocker` during a download or
  load, asking before quitting during a download, "Use a dump file I have" with a file dialog, and
  a folder picker when there is too little space (ELEC-07, ELEC-08, ELEC-09).
- **ELEC-03,** the token in a real keychain, on a runner with an unlocked keychain
  ([PLAN](e2e/PLAN.md#electron)).
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
