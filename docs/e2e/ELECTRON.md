# Electron E2E plan

Read this when implementing or debugging the Electron test host. Start with the [E2E guide](../E2E_TESTING.md)
and its binding rules. The host and its scenarios are not built. Read [HARNESS](HARNESS.md) for the shared
contracts, [Electron scenarios](scenarios/electron.md) for coverage, and the product
[Electron plan](../ELECTRON_PLAN.md) for packaging.

## Launch and release builds

The design reuses the shared suite through an Electron host. Validate that design in the
spike before building the host, harness preload and Electron-only scenarios.

- **Launch.** `_electron.launch({ args: ["-r", preload, mainEntry], env })` with the isolated
  environment, `--user-data-dir` in the test's temp folder (the plan keeps the token file and the
  log in userData, which `DIGGA_DATA_DIR` does not move), the host-resolver switch and the
  keychain switches below. Then the sequence from [Startup order](#startup-order), then `firstWindow()` with its
  content size set to 1600 x 1000.
- **Main-process stubs.** Installed by the preload before the app's first line:
  `shell.openExternal`, `dialog.showMessageBox`, `dialog.showOpenDialog`, and spies on
  `setProgressBar` and `Notification`, recording calls for the test.
- **Native module ABI.** `better-sqlite3` 13 is a Node-API addon, and Electron loads the
  repository's prebuild in the main process and in workers without a rebuild (decision 153 in
  `DECISIONS.md`), so the unpackaged test run uses the repository's install. A rebuild in the
  repository's `node_modules` would still break the CLI, vitest and the web E2E host, so packaging
  must not run one there. The fakes run in the Playwright worker and need no native module.
- **Fuses.** `_electron.launch()` starts Electron with inspector arguments to attach to it, so a
  build with the `EnableNodeCliInspectArguments` fuse off cannot be launched by Playwright at
  all. The suite runs on an inspectable variant of each release candidate that differs only in
  that fuse. The final fused artifact gets a smaller check without Playwright: launched with the
  isolated environment, `--user-data-dir`, an empty library and the fake service URLs, with no
  preload and no hold, it must write its "listening on" line to its log and answer
  `GET /api/health`, and it is then stopped. Nothing guards it but the environment, so the check
  does nothing more.
- **Keychain.** `safeStorage` uses the macOS Keychain, libsecret or kwallet on Linux, and DPAPI on
  Windows. Playwright's loader, used with the `electron` package, always adds
  `--use-mock-keychain` and `--password-store=basic`; with `executablePath` there is no loader
  and no switches. The host therefore passes both switches itself, so no run touches the
  developer's login keychain. On Linux the basic store makes `safeStorage` report encryption as
  unavailable unless `safeStorage.setUsePlainTextEncryption(true)` was called, so the preload
  calls it there. The Electron spike checks a save, relaunch and read round trip with these
  settings on each OS. ELEC-03 alone omits the switches and runs on an `executablePath` build on
  a runner with a real, unlocked keychain.
- **Linux CI** needs a display: `xvfb-run`, whose `DISPLAY` and `XAUTHORITY` the launch helper
  passes through.
- **Downloads and external links** go through the handlers from [Product integration requirements](#product-integration-requirements).

## Shared host contract

**Electron host.** `relaunch()` quits the app and launches it again on the same library, with
the same preparation. `restartServer()` is not available: the server lives in the main process,
and restarting it alone would need a main-process API the product does not plan. Scenarios that
need it are tagged web.

`_electron.launch()` has no `viewport`, `reducedMotion` or `serviceWorkers` option, and the test
runner's `use` options, automatic screenshots and `trace` setting do not reach an Electron app.
The Electron host therefore passes `locale`, `timezoneId` and `colorScheme` to `launch()`, calls
`page.emulateMedia({ reducedMotion: "reduce" })`, sets the window's content size, and starts and
stops tracing and takes the failure screenshot itself.

## Startup order

- **Electron.** `electron/main.ts` starts the server and loads the window as soon as the app is
  ready (`docs/ELECTRON_PLAN.md`). The host launches it with a harness preload,
  `-r tests/e2e/support/electron-preload.cjs` before the main entry, which runs in the main
  process before the app's first line:
  - it installs the socket guard, so all main-process code is guarded, `loadConfig()` included;
  - it stubs `shell.openExternal`, `dialog.showMessageBox` and `dialog.showOpenDialog`, spies on
    `setProgressBar` and `Notification`, and registers the download handler once the session
    exists;
  - it wraps `BrowserWindow.prototype.loadURL`, so the first call records its URL and waits until
    the host calls `globalThis.diggaE2e.release()`.

  The host polls through `electronApp.evaluate()` until the preload reports the held URL. The
  server is running by then and its origin is known. On `electronApp.context()` the host
  installs the routes for that origin, the fake YouTube script and the clock, applies the given
  state through the API, and releases the navigation. The product has no code for this. ELEC-13
  tests the sequence.

  Electron may ignore `-r` in a packaged build. The Electron spike checks it on the inspectable
  release candidate. If the flag is ignored there, the product gets one test hook at the same
  point: with `DIGGA_E2E_HOLD=1` the main process waits after `server.start()` and before
  `loadURL()`, and the host installs the guard and the stubs through `evaluate()` while it waits
  (`require` is not defined there; the guard takes `net` from `process.getBuiltinModule()`).
  Node code that runs before that point is then unguarded, and only the fake service URLs keep
  it from the real services; the resolver rule still covers Chromium's network and
  `electron.net`.

Playwright removes `NODE_OPTIONS` from Electron launches, so the preload installs the Node
socket guard itself. A worker started from a file inherits a guard loaded with
`NODE_OPTIONS=--import`, but not one a `-r` preload loaded (measured on 2026-10-06 with Electron
44, [HISTORY](HISTORY.md#the-electron-main-process-electron-unpackaged)), so the preload wraps
`worker_threads.Worker` to load the guard first. Apply Chromium's resolver switch
from [HARNESS](HARNESS.md#the-network-and-filesystem-guard) to cover preconnects and
`electron.net`, which the Node socket patch does not cover.

## Product integration requirements

`electron/main.ts` meets these, as built on 2026-10-06: it honors `DIGGA_DATA_DIR`,
`DIGGA_DUMPS_DIR`, `DIGGA_CONFIG_FILE` and all three fake-service URL settings through the CLI's
`src/cli/environment.ts`; its secrets give `DISCOGS_TOKEN` precedence over `safeStorage`, as the
CLI does; `window.open` goes through `setWindowOpenHandler` and `shell.openExternal`, downloads
through `will-download`; and `before-quit` waits for `server.stop()`, so jobs become cancelled
and the database closes. A change must keep them.

No rebuild may replace the repository's `better-sqlite3`. The preload must keep following the
app's navigation method, `loadURL()` in `electron/window.ts`; a change to `loadFile()` needs
corresponding interception, which ELEC-13 checks. Playwright's Electron support is experimental;
validate these assumptions in the [spike](PLAN.md#electron) before implementing the host.

Where `safeStorage` cannot encrypt, the owner chose the plain-text store: the token is saved as
text in `secrets.env`, and Settings says "saved unencrypted" (decision 152). Under the basic
store on Linux, without `setUsePlainTextEncryption(true)`, the app therefore saves the token as
text (untested). ELEC-03 requires a real unlocked keychain; ordinary runs use the
mock-keychain settings above.
