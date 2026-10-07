# Electron only

Read this when working on electron only coverage. Follow the [E2E rules](../../E2E_TESTING.md#rules-for-agents-writing-e2e-tests)
and [authoring guidance](../AUTHORING.md). [Scenario conventions and other families](README.md).

`tests/e2e/specs/electron.e2e.ts` implements ELEC-01, ELEC-02, ELEC-04, ELEC-05, ELEC-06, ELEC-10,
ELEC-11 and ELEC-13 on the unpackaged app, tagged `@electron`, through the
[Electron host](../ELECTRON.md). ELEC-03, ELEC-07, ELEC-08, ELEC-09 and ELEC-12 wait for packaging or
for the setup's Electron features; [PLAN](../PLAN.md#electron) says what each waits for.

## ELEC-01

Priority: **P0**.

The app starts its server on a free port bound to `127.0.0.1` and opens the window at `localhost`:
the URL the window asks for is `http://localhost:<port>`, the log says "listening on
http://127.0.0.1:<port>", the port is not the config's 3456, a connection to the port on another of
the machine's addresses is refused, and the app's page then opens on that origin

## ELEC-02

Priority: **P1**.

The library is the one the environment names, and userData, which holds the log, Chromium's files
(`Chromium`, decision 155) and `Crashpad`, the one `--user-data-dir` names; the log names the library.
The token file is the library's `secrets.env` (decision 152), which holds the saved token encrypted
and not its text; the library holds Digga's files only. Nothing is written to the real userData:
none of the files the app's processes hold open for writing lies in the home folder, outside the
test's folder. A file written and closed earlier is not seen; the preload's refusal (GUARD-03) keeps
userData itself in the test's folder

## ELEC-03

Priority: **P1**.

The token saved in Settings is stored with `safeStorage` (the file holds no plain token) and
survives a relaunch; runs only on an `executablePath` build launched without the mock-keychain
switches, on a runner with an unlocked keychain

## ELEC-04

Priority: **P1**.

`O` and `S` in Triage, `Y` and the release's discogs.com link in Twelves call `shell.openExternal`
with the release's page or the YouTube search, in that order, and the app logs "opening … in the
browser" for each; the app still has one window, on Twelves

## ELEC-05

Priority: **P1**.

An export link saves through `will-download`: the file is in the folder the preload set, holds the
export, its download ends `completed`, no dialog opened, and the app's own handler logs "download of
… completed: …"

## ELEC-06

Priority: **P2**.

The Library menu's items open the Settings tab that starts each job (decision 157): Update the
Catalogue… the Library tab, Import from Discogs… the Discogs tab and Back Up… the Backups tab, each
`aria-current`; a wantlist import started on the tab the menu opened ends done with its count, and
Back up now there says "Backup saved."; Settings… in the application menu opens Settings

## ELEC-07

Priority: **P1**.

Quitting during the download asks first (stubbed `dialog.showMessageBox`); cancel keeps it running;
confirm waits for `server.stop()`, and the job ends cancelled

## ELEC-08

Priority: **P2**.

The load's progress reaches `BrowserWindow.setProgressBar`; a notification when it ends unfocused;
`powerSaveBlocker` runs only during download and load

## ELEC-09

Priority: **P2**.

"Use a dump file I have" with a stubbed `showOpenDialog` loads the fixture dump

## ELEC-10

Priority: **P2**.

`nativeTheme.themeSource` follows the saved scheme before the first paint: with Light or Dark saved,
it is that scheme while the window's first navigation is held, and once the host's emulated scheme
is cleared the page's `prefers-color-scheme` matches it

## ELEC-11

Priority: **P1**.

The window's user agent does not name Electron (YouTube embeds reject it): it ends in Chrome's
tokens, names neither Electron nor Digga, and is the one the page's requests send

## ELEC-12

Priority: **P2**.

The history import's permission error shows the Full Disk Access dialog (macOS)

## ELEC-13

Priority: **P1**.

Before the held navigation is released, the window has not loaded the app (no page, an empty URL)
and the fakes logged no request, while the server answers `/api/health`; the main process and a
worker it starts cannot connect to a loopback port other than the fakes'; after release the page
loads with the routes and fake YouTube in place: the player is the fake, and a page request to the
other port is refused (declared) and never reaches it
