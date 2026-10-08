# Electron E2E host

Read this when running, changing or debugging the Electron test host. Start with the
[E2E guide](../E2E_TESTING.md) and its binding rules. Read [HARNESS](HARNESS.md) for the shared
contracts, [Electron scenarios](scenarios/electron.md) for coverage, and the product
[Electron plan](../ELECTRON_PLAN.md) for packaging.

The host runs the shared suite and the Electron-only scenarios on macOS, on the unpackaged app,
`electron/main.ts` from this repository, or on the packaged app's inspectable variant
([The packaged app](#the-packaged-app)). It was built on 2026-10-07 after the spike in
[HISTORY](HISTORY.md#the-electron-spike-electron-unpackaged). Windows and Linux wait for their
packages ([PLAN](PLAN.md#electron)).

## Running

`vp run e2e:electron` builds the client and runs
[playwright.electron.config.ts](../../tests/e2e/playwright.electron.config.ts), whose one project,
`electron`, sets the fixture option `host: "electron"` and leaves out tests tagged `@web`.
`vp run e2e:packaged` packages the app and runs
[playwright.packaged.config.ts](../../tests/e2e/playwright.packaged.config.ts), whose project,
`electron-packaged`, also sets `electronExecutable` to the inspectable variant's executable. The
default configuration has only the web project and leaves out `@electron`, so `vp run e2e`,
`vp run e2e:smoke`, `vp run verify` and CI never start Electron. CI also skips Electron's binary
download and never packages.

```sh
vp run e2e:electron                                                                    # build, then every Electron test
npx playwright test --config tests/e2e/playwright.electron.config.ts --grep '@ELEC-13\b'  # after vp build
npx playwright test --config tests/e2e/playwright.electron.config.ts --workers 4         # choose workers for the load
vp run e2e:packaged                                                                    # package, then every test on the inspectable variant
npx playwright test --config tests/e2e/playwright.packaged.config.ts --workers 4         # on the last package
```

A spec run on the packaged configuration tests the last package: after a change to `src/`,
`electron/` or `dist/`, package again first.

Each test starts a whole Electron app: a main process with the server, a GPU process, a network
process and a renderer. Use fewer workers than for the web project; on the 10-core Mac four
workers ran the suite in about two minutes. The windows open on screen while they run, at the
size macOS allows. A shell inside another Electron app may export `ELECTRON_RUN_AS_NODE=1`; the
host builds the app's environment from nothing, so it does not reach the app.

## Launch

[hosts/electron.ts](../../tests/e2e/support/hosts/electron.ts) implements `DiggaApp`. Each launch
is `_electron.launch()` with:

- `args`: `-r tests/e2e/support/electron-preload.cjs` and the repository's folder (so
  `package.json`'s `main` and `productName` apply, as in `vp run electron:dev`), both left out for
  a packaged build, then `--user-data-dir=<test folder>/user-data`,
  `--use-mock-keychain`, `--password-store=basic` and the host-resolver switch from
  [HARNESS](HARNESS.md#the-network-and-filesystem-guard). Playwright puts its own loader, `--inspect=0`
  and `--remote-debugging-port=0` before them.
- `env`: the CLI's environment from `diggaVariables()` in `spawn.ts`, built from nothing, with
  `DIGGA_E2E_TEMP_ROOT` (the test's folder) and `DIGGA_E2E_DOWNLOADS_DIR` (`<test folder>/downloads`)
  for the preload, and `DIGGA_E2E_HOLD=1` for a packaged build. Playwright removes `NODE_OPTIONS`
  from an Electron launch, so the preload loads the guard instead.
- `cwd`: the test's working folder, which holds no `.env`.
- `locale`, `timezoneId` and `colorScheme` from `PAGE_SETTINGS` in `app.ts`, which the web host's
  context uses too.

Before the launch, the host checks every `DIGGA_*` path, the home and the working folder against
the test's folder, and refuses to start without `--user-data-dir` inside it. With `productName`
"Digga", Electron's default userData is the owner's library folder.

**Keychain.** `safeStorage` uses the macOS Keychain, libsecret or kwallet on Linux, and DPAPI on
Windows. Playwright's loader adds `--use-mock-keychain` and `--password-store=basic` only when it
starts the `electron` package; with `executablePath` there is no loader. The host passes both
switches itself, so no run touches the developer's login keychain. Under the mock keychain a
saved token is stored encrypted (`DISCOGS_TOKEN_ENCRYPTED=djEw…`, Chromium's `v10` format) and
read back after a relaunch. On Linux the basic store makes `safeStorage` report encryption as
unavailable, and the app then saves the token as text (decision 152, untested). ELEC-03 alone
omits the switches and runs on an `executablePath` build on a runner with a real, unlocked
keychain.

**Native module ABI.** `better-sqlite3` 13 is a Node-API addon, and Electron loads the
repository's prebuild in the main process and in workers without a rebuild (decision 153), so the
test run uses the repository's install. A rebuild in the repository's `node_modules` would break
the CLI, vitest and the web host, so packaging must not run one there.

## The harness preload

[electron-preload.cjs](../../tests/e2e/support/electron-preload.cjs) runs in the main process with
`-r`, after Playwright's loader and before the app's first line; in a packaged build the host
loads it while the app waits for it ([The packaged app](#the-packaged-app)). In order, it:

1. exits with code 78 unless `app.getPath("userData")` and every `DIGGA_*` path that is set lie
   inside `DIGGA_E2E_TEMP_ROOT`, comparing real paths (Electron reports `/private/var` for `/var`
   on macOS). Electron has created the userData folder by then, empty; the preload exits before
   anything is written into it (in a packaged build Chromium has written its folder there).
   GUARD-03 tests the refusal;
2. loads `tests/e2e/support/guard.ts`, and replaces `worker_threads.Worker` with a subclass whose
   workers `--import` the guard first, then calls `syncBuiltinESMExports()` so the app's
   `import { Worker }` binding gets the subclass. A file worker inherits a guard loaded with
   `NODE_OPTIONS=--import` but not one a `-r` preload loaded;
3. replaces `shell.openExternal` with a recorder, and `dialog.showMessageBox` and
   `dialog.showOpenDialog` with stubs: the app's own message box answers with its first button
   and is also printed to stderr (a startup error quits, after which nothing can read the
   record), and an open dialog answers as cancelled. A page's `alert()` or `confirm()` also
   reaches `showMessageBox`, with an abort signal; the stub leaves it unanswered, and the test
   answers it through Playwright's `dialog` event, as in the web host;
4. records `BrowserWindow.setProgressBar()` calls and passes them on, and records notifications
   without showing them;
5. sets each download's save path in `DIGGA_E2E_DOWNLOADS_DIR` from `will-download`, so no save
   dialog opens, and records its `done` state;
6. holds the app's start: the app's `app.whenReady()` resolves once Electron is ready and the host
   has called `globalThis.diggaE2e.start()`;
7. holds the window's first `loadURL()`: `globalThis.diggaE2e.heldUrl` resolves with the URL the
   app asked for, and `release(url)` lets the navigation go on, to `url` when given.

`globalThis.diggaE2e.recorded` holds the records; the host reads them through
`electronApp.evaluate()`.

## Startup order

1. The host launches the app. The preload has installed the guard and the stubs, and holds the
   start.
2. On `electronApp.context()` the host installs the context guard (routes that refuse everything
   until the app's origin is allowed), the fake YouTube init script, the clock when the test asks
   for it, the problem log and tracing. The window does not exist yet: Playwright cannot install
   routes on a context whose window waits for its first navigation (the call does not return),
   so the context must be ready before the window is created.
3. The host calls `start()`. The app starts its server, sets the theme, the user agent and the
   menu, creates the window and calls `loadURL()`, which the preload holds.
4. The host awaits `heldUrl` through `evaluate()`: the server runs and its origin is known. It
   allows that origin, compares the `library:` line in `userData/digga.log` with the library it
   gave, applies the given state through the API, and runs the test's `beforeRelease` hook at the
   first launch (ELEC-10, ELEC-13).
5. The host sets the window's content size to 1600 x 1000 and releases the navigation to
   `about:blank`. It then takes the window with `firstWindow()`, emulates reduced motion and sets
   the page's viewport to 1600 x 1000: macOS keeps a window within the screen (1600 x 917 on a
   1512 x 982 display), and `reducedMotion` is not a launch option.
6. The window stays blank until `open()`, which loads the app's page with `page.goto()`, as the
   web host's page does. Tests may arm waits and install init scripts on `app.page` before
   `open()` on both hosts. The URL the app asked for is `electron.windowUrl` (ELEC-01).

ELEC-13 tests the sequence. The product has no code for it. The preload must keep following the
app's start method, `app.whenReady()` in `electron/main.ts`, and its navigation method,
`loadURL()` in `electron/window.ts`; a change to `loadFile()` needs corresponding interception.

## The packaged app

A packaged build ignores `-r`, with or without its fuses, and Playwright's loader too, which it
adds only for the `electron` package. So the product has one test hook (decision 162): with
`DIGGA_E2E_HOLD=1` from the environment, `electron/main.ts` sets `sessionData` and then waits,
before it reads the environment or calls `app.whenReady()`, until `globalThis.diggaE2eHold.release()`
is called. The wait is a promise, not a top-level `await`: Electron starts Chromium, and with it
the DevTools endpoint Playwright needs, only after the main module has been evaluated.

With `executablePath`, the host passes neither `-r` nor the repository's folder, adds
`DIGGA_E2E_HOLD=1`, and after the launch calls `preloadHeldApp()`: it waits through `evaluate()`
until the hold exists, loads the same preload with `process.getBuiltinModule("node:module")`'s
`createRequire()` (`require` is not defined in `evaluate()`), and releases the hold. The preload
then does what it does after `-r`, and the startup order goes on at step 2. Static imports of
`electron/main.ts` have been evaluated by then; none of them connects anywhere, and
`syncBuiltinESMExports()` still reaches their `Worker` binding.

What differs from `-r`:

- Chromium has started before the preload runs, so a refused `--user-data-dir` already holds
  Chromium's `Chromium` folder when the preload exits with 78; Digga's code has not run and no
  library exists. The host's own check before every launch keeps userData in the test's folder,
  and GUARD-03 expects the folder on the packaged configuration.
- Node code before the hold is unguarded, and only the fake service URLs keep it from the real
  services; it makes no connection. The resolver rule covers Chromium's network and
  `electron.net` from the first moment.
- The release build has no inspector, so `DIGGA_E2E_HOLD=1` only stops it: nothing can release
  the hold.

## Shared host contract

- `relaunch()` blanks the page, quits the app and launches it again on the same library and
  userData, or on the library given, with the same preparation; the given state and the
  `beforeRelease` hook are not applied again. `relaunch({ crash: true })` kills the main process,
  and Chromium's helpers end with it.
- `restartServer()` throws: the server lives in the main process, and restarting it alone would
  need a main-process API the product does not plan.
- `openPage()` throws: the app opens one window, and a second would need a product feature.
- `expectExternalOpen()` reads the URL the stub of `shell.openExternal` recorded after the action.
  An external open outside the helper, or a message box of the app's, fails the test like an
  undeclared problem.
- `expectDownload()` waits until the download the action started reaches `done`, and fails unless
  it completed; the file is in `<test folder>/downloads`.
- `paste()`, `abortRequests()`, `apiRequests()`, `expectProblems()` and `cli()` work as in the web
  host.
- `app.servers` holds each launch's output: `stdout` is the launch's part of `userData/digga.log`,
  where the server logs (a packaged app prints nothing, and an unpackaged one prints the same
  lines), and `stderr` the process's, where the guard reports. GUARD-01, PER-03 and the ELEC
  scenarios read them there; quitting waits for the log's "stopped" line.
- `ElectronApp` also has `electronApp`, `windowUrl`, `userDataDir`, `downloadsDir` and
  `recorded()` for the ELEC scenarios.

The test runner's `use` options, automatic screenshots and `trace` setting do not reach an
Electron app. The host starts tracing on each launch's context, keeps an earlier launch's trace in
the test's folder, and on failure attaches a screenshot and every launch's trace
(`trace-launch-1`, …). A passing test's last trace is discarded.

axe finishes a scan in a blank page it opens in the context, which Electron cannot do
(`Target.createTarget: Not supported`). `support/axe.ts` uses axe's legacy mode for a context
without a browser, Electron's, which also scans the fake player's frames.

## The shared suite on Electron

Every shared test runs on Electron unless it is tagged `@web`, and each `@web` test says why in
a comment. On 2026-10-07 the web project had 174 tests and the Electron project ran 167 of
them. The seven `@web` tests cannot apply to the app:

| Test                 | Why it is web only                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| PER-05               | `restartServer()`: the app's server runs in its main process and cannot restart alone                           |
| PER-10 (two tests)   | `openPage()`: the app opens one window                                                                          |
| SHELL-06             | the app always opens `localhost`, and its window has no address bar to open `127.0.0.1`                         |
| SHELL-10 (two tests) | the window keeps history, but neither its menus nor its keys offer Back or Forward                              |
| GUARD-02             | it checks the browser guard in a Chromium context of its own, without the app; ELEC-13 checks the app's context |

PER-11 runs on both: the library lock names "the Digga server" on the web and "the Digga app"
on Electron (decision 151), so the test takes the name from the `host` fixture.

## Quitting

The host blanks the page first, as the web host closes its context first, so none of the page's
requests meets a stopped server. It then calls `app.quit()` through `evaluate()`, which runs
`before-quit` and waits for `server.stop()`. A server that has not logged "stopped" within 15 s is
a bug: the host kills the app and fails the test. An app whose server has stopped but whose process
is still running 10 s later is killed, and the host prints "digga-e2e: killed the Electron app …".
In the measured runs no app needed it: the server stopped a median 90 ms after `app.quit()` and the
process exited after 261 ms (at most 909 ms, 183 quits). The 20 s exits of the rehearsal followed
`browser.close()` over CDP, not `app.quit()`.

## Product integration requirements

`electron/main.ts` meets these, as built on 2026-10-06: it honors `DIGGA_DATA_DIR`,
`DIGGA_DUMPS_DIR`, `DIGGA_CONFIG_FILE` and all three fake-service URL settings through the CLI's
`src/cli/environment.ts`; its secrets give `DISCOGS_TOKEN` precedence over `safeStorage`, as the
CLI does; `window.open` goes through `setWindowOpenHandler` and `shell.openExternal`, downloads
through `will-download`; and `before-quit` waits for `server.stop()`, so jobs become cancelled
and the database closes. A change must keep them. The harness needs one product change, the
`DIGGA_E2E_HOLD` hook in `electron/main.ts`, for the packaged app ([The packaged app](#the-packaged-app)).

Electron writes outside userData too, independent of `--user-data-dir`: on macOS, `HOME` and
`TMPDIR` move neither `appData`, `home`, `downloads` nor `temp`, and Chromium keeps a file in the
real temp folder and macOS a Metal shader cache for the Electron binary in `/var/folders`. None of
it is in the home folder, where every userData lies; ELEC-02 checks the files the app holds open
for writing.

**Fuses.** `_electron.launch()` starts Electron with inspector arguments to attach to it, so a
build with the `EnableNodeCliInspectArguments` fuse off cannot be launched by Playwright at
all. `vp run electron:package` builds an inspectable variant beside the release build that
differs only in that fuse (`release/inspectable/`, [ELECTRON_PLAN](../ELECTRON_PLAN.md#packaging)). The fused release build
gets a smaller check without Playwright, `scripts/electron-health-check.ts`, which
`vp run electron:package` runs after packaging (decision 163): in a new temp folder, with an
environment built from nothing, `--user-data-dir`, the mock-keychain switches, the resolver rule,
an empty library and the URLs of fake services it starts, with no preload and no hold, the app
must write its "listening on" line to `digga.log` and answer `GET /api/health`, and it is then
stopped with SIGTERM, after which the log says "stopped". The script prints the environment and
the command line first, and refuses to start unless every path lies in the temp folder and every
service URL is a loopback one. Nothing guards the app but the environment, so the check does
nothing more.

```sh
node scripts/electron-health-check.ts                         # release/mac-arm64/Digga.app
node scripts/electron-health-check.ts path/to/Digga.app       # another build
```

**Linux CI** needs a display: `xvfb-run`, whose `DISPLAY` and `XAUTHORITY` the environment passes
through. Running Electron in CI is not planned yet.
