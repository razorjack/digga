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
5. calls `createServer({ ..., libraryHolder: "the Digga app", desktop })`, which takes the
   library lock, and starts it on a free port on 127.0.0.1; the `desktop` hears every job change
   ([Desktop](#desktop));
6. sets `nativeTheme.themeSource` from the saved colour scheme, so the first paint uses it; a
   change in Settings applies in the renderer at once and reaches `nativeTheme` on the next start;
7. gives the default session Chrome's user agent without the app's and Electron's tokens
   (`electron/user-agent.ts`), since YouTube refuses some embeds to an unknown browser;
8. denies permission requests and sends downloads through a save dialog (`secureSession()`);
9. sets the menu and opens the window at the server's `localhost` address, where YouTube accepts
   the embeds.

Any error before the window opens shows a dialog and quits. A quit during the start shows none:
it stops the server under the window still loading the app, whose `loadURL()` then fails, and
the dialog used to keep the app from exiting until someone answered it (ELEC-14 tests it). When
the library lock is held, the dialog says another Digga is using the library and names the holder from `digga.lock`, such as
"the Digga server (process 4242, since ...)". Electron's single-instance lock is not used
(decision 156). When `digga.config.json` is not JSON or breaks the schema, the dialog names the
problem and offers "Open the Library Folder", which shows the file in Finder, and Quit (decision
183).

Quitting waits for `server.stop()` in `before-quit`: running jobs end cancelled with the error
`QUIT_JOB_ERROR` ("Digga quit"), which a Cancel the user pressed does not record, so step 1 can say
that a quit stopped the download and that it starts over. The daily backup being written
finishes, the database closes and the lock is released, and then the app quits.
During a download or load it asks first (decision 166): "Quit while Digga downloads and loads
the catalogue?", where the download stands and that Discogs does not resume it, how far the load
has read and that the releases it kept stay (`quitQuestion()` in `electron/dump-jobs.ts`). Cancel
keeps them running; Quit, the default, stops the server. A second quit while the question is open
or the server stops waits for it. Closing the window quits, on macOS too, through the same
question, so Cancel keeps the window. SIGTERM goes the same way, since Chromium handles it as a
quit.

## Desktop

`createServer` takes an optional `desktop` (`src/server/desktop.ts`, decision 165), which
`electron/desktop.ts` implements and the CLI's server leaves out. The job runner reports each
change of a job to it: its start, every progress report and its end. The main process keeps the
downloads and loads that run (`electron/dump-jobs.ts`), without asking the page, and from them
(decision 167):

- sets the window's progress bar, on the Dock icon: how far the load has read while one runs,
  else how much of the download has arrived, indeterminate while the size is unknown, and none
  once neither runs;
- keeps the Mac awake with `powerSaveBlocker.start("prevent-app-suspension")` from the first
  download or load until none runs, however they end;
- notifies when a load or update finishes or fails while no window of the app is focused, after
  logging the notification ("notification: The catalogue is in: 1,500 releases kept."); clicking
  it shows the window;
- asks before quitting (below).

The page reaches the app's native dialogs through `/api/desktop` routes, which only a server with
a `desktop` registers (`src/server/routes/desktop.ts`, decision 168). `GET /api/setup` reports
`desktop: true` there, and only then does the setup offer them; in the browser they are not
there. `POST /api/desktop/dump-file` shows "Use a dump file you have", an open dialog for one
`.xml.gz` file, and answers the path, or null when cancelled. `POST /api/desktop/dumps-folder`
shows "Choose a folder for the catalogue" and saves the folder as the dumps folder (decision 169),
unless `DIGGA_DUMPS_DIR` names it or a download or load runs. Digga never creates a chosen folder,
which may be on a disk that is not connected; step 1 says when it or a chosen file is not there.

## Window

`electron/window.ts` opens one `BrowserWindow` with `contextIsolation`, `sandbox`, no
`nodeIntegration` and no preload. The renderer is the browser client: it reaches the server over
HTTP through `src/client/api.ts`, and nothing in it knows it runs in Electron. Switching to IPC
later would mean replacing `createHttpApi()` in that one file.

- **Title bar.** On macOS the page's toolbar is the title bar (decision 173): `titleBarStyle:
"hidden"` with the traffic lights at (20, 19), centred on the 52 px toolbar, and
  `titleBarOverlay: true`, which gives the page the Window Controls Overlay CSS variables. The
  toolbar's padding reads `env(titlebar-area-x)` and `env(titlebar-area-width)`, whose fallbacks
  add nothing in a browser, so the client has no platform code. The toolbar's empty space is an
  `app-region: drag` area; its links are not. Windows and Linux keep the system's title bar for
  now ([below](#title-bar-on-windows-and-linux)).
- **Size and place.** The window opens where it was closed, from `userData/window-state.json`
  (the normal bounds and whether it was maximised), unless no display shows enough of its top
  edge to drag it; then, and on the first start, it opens at 1440 x 900, centred. Its minimum is
  1080 x 680, so Triage keeps two columns and the toolbar one row.
- **First paint.** The window shows on `ready-to-show`, over the page's ground colour for the
  scheme `nativeTheme` uses, so it never flashes white.

- `window.open` and `target="_blank"` links go to `shell.openExternal` when they are http(s)
  pages elsewhere and are refused otherwise (`electron/links.ts`). The app opens no windows of
  its own.
- Navigation away from the app's origin is refused; an http(s) target opens in the browser.
- Downloads (the exports) ask where to save, starting in Downloads, and the log records where
  they went.
- Every permission request is denied, YouTube's fullscreen included.

## Menu

`electron/menu.ts` builds an app's menus, not a browser's: macOS's application menu with
Settings… (⌘,), the File, Edit and Window roles (Edit gives copy and paste in text fields on
macOS), a View menu and a Library menu. On Windows and Linux, File holds Settings… and Quit.

- **View** shows Triage (⌘1) and Twelves (⌘2), opens the Keys dialog (⌘/) by dispatching `?` to
  the page, and toggles full screen. Reload and the developer tools are there only in an
  unpackaged run (`!app.isPackaged`); a packaged app has no Reload (decision 173).
- **Right-click** opens a native menu (`electron/context-menu.ts`): Cut, Copy, Paste and Select
  All in a text field, Copy on selected text, and nothing elsewhere.
- **Library**'s items open the Settings tab that starts each job instead of starting it there
  (decision 157):

| Item                  | Opens                | The tab's jobs                            |
| --------------------- | -------------------- | ----------------------------------------- |
| Update the Catalogue… | `#/settings/library` | update, download, load (also from a path) |
| Import from Discogs…  | `#/settings/discogs` | collection, wantlist, Maybe list, seller  |
| Back Up…              | `#/settings/backups` | Back up now                               |

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
  Only the English locale is kept.
- **Icon.** `build/icon.icns`: the mole from the waist up in front of a flyer-yellow disc, on the
  app's dark ground with its grain and a faint light rim. It follows Apple's grid, an 824 px body
  with 185 px corners in the 1024 px canvas and the drop shadow macOS's own icons carry; both were
  measured against the system's icons. `node scripts/make-icon.ts` draws it from
  `docs/assets/digga-mole-dark.png` (macOS only: Playwright's Chromium, `sips` and `iconutil`).
  An unpackaged run sets `build/icon.png` as its Dock icon, since it is Electron's app otherwise.
  `build/` is not packaged. Windows and Linux need another image ([below](#icon-on-windows-and-linux)).

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
- **A version.** `package.json` says `0.0.0`, which names the dmg.
- **The ×10 burn-in** of the Electron configuration on a quiet machine ([PLAN](e2e/PLAN.md#electron)).

Later:

- **Other packages:** x64 for Intel Macs (one more target, once a Mac with Rosetta or an Intel
  Mac can start it), win (nsis, signed only through a free service, if one qualifies), linux
  (AppImage or deb), each with its better-sqlite3 prebuild, checked to load in the packaged app,
  and the E2E suite on each. Node does not strip types from files under `node_modules`, which
  matters only if the app moves there. The title bar and the icon on each are planned below
  ([title bar](#title-bar-on-windows-and-linux), [icon](#icon-on-windows-and-linux)).
- **ELEC-03,** the token in a real keychain, on a runner with an unlocked keychain
  ([PLAN](e2e/PLAN.md#electron)).
- **Auto-update.**

### Title bar on Windows and Linux

Read this before Windows or Linux work on the window. On macOS the app's toolbar is the title bar:
the window hides macOS's bar, the traffic lights sit inside the toolbar, and the page keeps clear
of them through the Window Controls Overlay CSS variables (`env(titlebar-area-x)`,
`env(titlebar-area-width)`, `env(titlebar-area-height)`), which `titleBarOverlay` enables. The
page has no platform code: in a browser, or under a system title bar, the variables are unset and
their fallbacks give no inset. Each platform's window options belong in one function in
`electron/window.ts`.

**Windows: hide the title bar and overlay the caption buttons.** Use `titleBarStyle: "hidden"`
with `titleBarOverlay: { color, symbolColor, height }`. Electron draws the native minimise,
maximise and close buttons on the right, in the colours passed, and the window keeps its frame:
resizing, the shadow, Windows 11's rounded corners and snapping. The same CSS variables keep the
toolbar clear of the buttons; on Windows `titlebar-area-x` is 0 and the width stops before them.

- The button colours follow the scheme. Pass the toolbar's colour (`--surface`) and text colour
  for the scheme in use. An Appearance change in Settings applies in the page at once but reaches
  the main process only at the next start ([Main process](#main-process), step 6), so the main
  process must hear it and call `setTitleBarOverlay()`. The server reports every job change to
  the `desktop`; an appearance change can reach it the same way.
- The overlay's height is the toolbar's height. The three buttons take about 140 px on the right,
  which the toolbar keeps free.
- No Mica or Acrylic (`backgroundMaterial`). They are Windows' vibrancy and clash with the
  photocopy look for the same reason vibrancy does on macOS.

**Linux: keep the system title bar.** `titleBarOverlay` colours and `setTitleBarOverlay()` exist
on Linux too, but Electron draws those buttons itself, and they are unlikely to follow the
desktop's theme or the user's button layout (GNOME shows only a close button by default, and some
users put the buttons on the left). Unverified; check it before deciding otherwise.

- KDE draws the title bar itself (server-side decorations), so a system title bar above an app
  toolbar is its normal look, with the user's theme and window rules.
- Tiling window managers draw no title bar; a hidden one would leave caption buttons in the
  toolbar.
- GNOME apps use a header bar, which the hidden title bar resembles, so the overlay could be
  enabled on GNOME later if its buttons look right. Electron under Wayland may draw the title bar
  itself in either case. Telling GNOME apart reads `XDG_CURRENT_DESKTOP`, which goes through
  `src/cli/environment.ts` like every other environment read.

Under a system title bar the toolbar still reads as an app's toolbar; that is the part that
matters on Linux.

**Check in the Windows and Linux sessions:**

- whether Electron still shows the menu bar under a hidden title bar; if it does,
  `autoHideMenuBar: true` hides it until Alt is pressed, as browsers do;
- whether Windows 11's Snap Layouts flyout appears on hovering maximise with the overlay;
- that a double-click on the toolbar maximises the window, and that dragging empty toolbar space
  moves it;
- that the button colours change after an Appearance change in Settings;
- how the Linux buttons look under GNOME and KDE, on Wayland and on X11, if the overlay is tried.

### Icon on Windows and Linux

Read this before packaging for Windows or Linux. `build/icon.icns` follows Apple's grid: the body
fills 824 px of the 1024 px canvas, and the margin holds a drop shadow. Neither Windows nor Linux
masks or shadows app icons, so the same image there would make Digga about a fifth smaller than
its neighbours, with a shadow no other icon has. `scripts/make-icon.ts` should draw a second
master for both from the same layers (dark ground, flyer-yellow disc, the mole from the waist up,
the grain, the rim) and write each platform's files from it.

- **Keep the plate.** Neither platform prescribes a shape, and an icon cut to the mole's outline
  is a common choice there. Digga's mole is dark, so without the dark ground and the yellow disc
  it disappears on a dark taskbar or panel. Use a rounded square with smaller corners than
  macOS's, about an eighth of the size, and no shadow.
- **Fill the canvas.** About 4% margin on each side for Windows, whose taskbar and Start menu
  show icons nearly edge to edge. Linux icon themes usually leave a little more; check GNOME's app
  icon template before fixing the number.
- **Windows files.** One `.ico` with 16, 20, 24, 32, 40, 48, 64 and 256 px images: 16, 24, 32, 48
  and 256 at least, and the others for 125% and 150% scaling. electron-builder takes `win.icon` as
  a `.ico` or a 256 px PNG that it converts; the NSIS installer and uninstaller take the same
  icon (`nsis.installerIcon`, `nsis.uninstallerIcon`).
- **Linux files.** PNGs at 16, 22, 24, 32, 48, 64, 128, 256 and 512 px for the hicolor theme.
  electron-builder's `linux.icon` takes a folder of them named by size (`512x512.png`) and
  writes the `.desktop` entry; an AppImage uses the largest.
- **Unpackaged runs.** On Linux, and on Windows before packaging, the window and the taskbar show
  Electron's icon unless the `BrowserWindow` gets an `icon`, the counterpart of `showDockIcon()`
  in `electron/main.ts`.
- **Small sizes.** At 16 px the mole is a dark shape; the yellow disc on the dark ground is what
  identifies the app. On macOS, tighter crops for 16 and 32 px only made a darker blob, so one
  drawing serves every size. Windows' 16 and 24 px taskbar sizes may still need a simpler drawing
  (the disc and the mole's head) if they read badly on a real taskbar.

**Check in the Windows and Linux sessions:** the icon on the taskbar, in Alt-Tab and in the Start
menu at 100% and 150% scaling, in light and dark themes; in GNOME's dash and KDE's panel, in
light and dark themes; and the installer's icon.

**macOS later.** macOS 26 added layered icons made with Icon Composer (`.icon`), which the system
renders in its Liquid Glass style with dark, tinted and clear appearances. An `.icns` that fills
the rounded square, as Digga's does, is shown unchanged; one that does not is put on a grey plate.
Digga's layers map onto an `.icon` directly (ground, disc, mole), but check that electron-builder
can package one before trying.

## What would break each rule

| rule                             | regression to watch for                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Server is a function             | starting the server at module import time, reading argv in `server.ts`, binding to `0.0.0.0`                                    |
| One transport seam               | a page or store calling `fetch`, `EventSource` or `WebSocket` directly                                                          |
| One place for paths              | `path.resolve('data')`, `__dirname` for user data, `process.cwd()` outside the CLI, `serveStatic({ root: './dist' })`           |
| One place for secrets            | `process.env.DISCOGS_TOKEN` read in the client, a job or `electron/`                                                            |
| Jobs are library functions       | job logic inside a Hono handler, the CLI switch or a menu item                                                                  |
| Heavy work off the server thread | running the loader inline in a route, synchronous file scans in handlers                                                        |
| Frontend environment-agnostic    | `window.location.pathname`, `localStorage` of absolute URLs, `import.meta.env` reads for paths, non-hash routing                |
| Native modules isolated          | importing `better-sqlite3` in an importer or test helper                                                                        |
| Logging through logger           | `console.log` in server modules or `electron/`                                                                                  |
| Server free of Electron          | an `electron` import in `src/`, `tools/` or `scripts/`; server code that tells the app from the CLI other than by its `desktop` |
| Enforce it                       | skipping `vp run check:portability` before commit                                                                               |
